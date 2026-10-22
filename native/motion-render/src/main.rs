//! motion-render: renders motion-use films natively. The film's drawing code (a JS `drawFrame` on a
//! Canvas 2D) runs in V8; the canvas is Skia on the CPU, so the same input gives the same pixels on
//! every run. Frames leave as raw RGBA: straight into ffmpeg, as .rgba files, or as fast PNGs for
//! motion-use's external-engine job contract.
mod canvas;
mod js;
mod page;
mod shape;
mod style;
mod text;
mod webgl;

use anyhow::{anyhow, bail, Context, Result};
use js::{Engine, Mode};
use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Instant;

const USAGE: &str = "motion-render — native renderer for motion-use films (Skia + V8)

As a motion-use external engine (film.json):
  \"engine\": {\"type\": \"command\", \"command\": [\"motion-render\", \"composition/draw.js\"]}
  motion-render [<draw.js> | <engine.html>] --job <job.json>   (or MOTION_USE_JOB=<job.json>)
    writes frames.from..frames.to as PNG into job.out (drop `composition` from film.json when the
    drawing runs here, or motion-use draws it again as an overlay)

Render a built page directly (motion-use's out/.build/<id>/index.html, or an engine page):
  motion-render render <index.html> [--engine --job <job.json>]
      (--at <t,t,...> | --frames <a-b>) [--fps <n>]
      [--out <dir> --format png|rgba] [--ffmpeg <out.mp4> --quality draft|looks|delivery]
      [--stream <path|->] [--workers <n>] [--stats]

Text check (motion-use's probe, run in this page's V8):
  motion-render probe <index.html> --times <t,t,...|times.json>   prints the probe's JSON

Options:
  --workers <n>   render on n workers, each with its own V8 isolate and Skia canvases: processes
                  when WebGL may run on the GPU (ANGLE's GPU backends do not scale across the
                  threads of one process), threads with --gl swiftshader or off;
                  MOTION_RENDER_PROCESSES=0|1 overrides
  --format        png (fast zlib level, default) or rgba (raw straight RGBA, w*h*4 bytes per frame)
  --ffmpeg <mp4>  pipe raw RGBA into ffmpeg (libx264, yuv420p, bt709, motion-use's settings)
  --stream <path> write raw straight RGBA frames in order to a file or FIFO (- is stdout), for an
                  encoder the caller runs (motion-use); a job does the same with
                  \"formats\": [\"rgba-stream\"], \"stream\": <path>
  --stats         print timing JSON on stdout (stderr when frames go to stdout)
  --gl <backend>  WebGL backend: auto (default: the GPU, else SwiftShader), gpu, metal, vulkan,
                  swiftshader (CPU, same pixels as Chrome's software GL), d3d11, off; same as
                  MOTION_RENDER_GL. WebGL runs on ANGLE, found next to this binary, in
                  MOTION_RENDER_ANGLE_DIR or ~/.cache/motion-render/angle (native/scripts/fetch-angle.sh)
  --capabilities  print what this build can do as JSON (motion-use checks it); \"webgl\" says
                  whether ANGLE loaded and made a context on this machine
";

#[derive(Clone)]
enum Sink {
    None,
    Png { dir: PathBuf, names: Arc<Vec<String>> },
    Rgba { dir: PathBuf, names: Arc<Vec<String>> },
}

struct Plan {
    page: page::Page,
    mode: Mode,
    job: Option<String>,
    size: Option<(i32, i32)>,
    times: Vec<f64>,
    sink: Sink,
    ffmpeg: Option<(PathBuf, String, f64)>,
    stream: Option<String>,
    workers: usize,
    stats: bool,
    /// The command line, for worker processes
    argv: Vec<String>,
    /// Set in a worker process: render frames k, k+n, k+2n… of the plan and stream them framed
    shard: Option<(usize, usize)>,
}

type Frame = Result<(usize, i32, i32, Vec<u8>)>;

#[derive(Default, Clone, Copy)]
struct Timing {
    setup_ms: f64,
    draw_ms: f64,
    write_ms: f64,
    frames: usize,
}

fn write_png(path: &Path, w: i32, h: i32, rgba: &[u8]) -> Result<()> {
    let f = std::fs::File::create(path).with_context(|| format!("writing {}", path.display()))?;
    let mut enc = png::Encoder::new(std::io::BufWriter::with_capacity(1 << 20, f), w as u32, h as u32);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_compression(png::Compression::Fast);
    enc.set_filter(png::FilterType::Sub);
    enc.set_adaptive_filter(png::AdaptiveFilterType::NonAdaptive);
    let mut wr = enc.write_header()?;
    wr.write_image_data(rgba)?;
    wr.finish()?;
    Ok(())
}

fn x264(quality: &str) -> (&'static str, &'static str) {
    match quality {
        "draft" => ("veryfast", "23"),
        "delivery" => ("slow", "14"),
        _ => ("medium", "16"),
    }
}

/// Whether `workers` run as processes (MOTION_RENDER_GL `gl`, MOTION_RENDER_PROCESSES `force`,
/// `webgl`: the page asks for a WebGL context). ANGLE's GPU backends do not scale across the
/// threads of one process (Apple M5 Pro, Metal: a three.js film 45 ms/frame on 1 thread, 318 on
/// 2; a raymarched WebGL2 terrain 115 and 227), while processes, one display each, do (14 and
/// 47 ms/frame on 8). A 2D page stays on threads, which skip the pipe (1.3 against 1.6 ms/frame),
/// and so do SwiftShader and no WebGL.
fn use_processes(gl: Option<&str>, force: Option<&str>, webgl: bool, workers: usize) -> bool {
    match force.map(str::trim) {
        Some("0") => return false,
        Some("1") => return workers > 1,
        _ => {}
    }
    let gl = gl.unwrap_or_default().trim().to_ascii_lowercase();
    workers > 1 && webgl && !matches!(gl.as_str(), "swiftshader" | "cpu" | "software" | "off" | "none")
}

/// Whether a script names a WebGL context type as a string ("webgl2", 'webgl', three.js's
/// `let D="webgl2"`), the way getContext is asked for one.
fn asks_for_webgl(code: &str) -> bool {
    ["webgl", "webgl2", "experimental-webgl"].iter().any(|n| ['"', '\'', '`'].iter().any(|q| code.contains(&format!("{q}{n}{q}"))))
}

/// The command line for worker process k of n: this one, rendering every nth frame from k to
/// stdout (framed) when the caller wants frames back, else into the same --out.
fn shard_args(argv: &[String], k: usize, n: usize, want_frames: bool) -> Vec<String> {
    let mut out = vec![];
    let mut i = 0;
    while i < argv.len() {
        match argv[i].as_str() {
            "--workers" | "--ffmpeg" | "--quality" | "--stream" | "--shard" => i += 2,
            "--stats" => i += 1,
            a => {
                out.push(a.to_string());
                i += 1;
            }
        }
    }
    out.extend(["--workers".into(), "1".into(), "--shard".into(), format!("{}/{}", k, n), "--stats".into()]);
    if want_frames {
        out.extend(["--stream".into(), "-".into()]);
    }
    out
}

/// Start worker process k of n. Its frames (indices k, k+n…, `count` of them) go into `tx`; the
/// thread returned waits for it and hands back its timing, or its error.
fn spawn_shard(argv: &[String], k: usize, n: usize, count: usize, want_frames: bool, tx: mpsc::SyncSender<Frame>) -> Result<std::thread::JoinHandle<Result<Timing>>> {
    use std::io::{BufRead, Read};
    let exe = std::env::current_exe().context("finding motion-render for its worker processes")?;
    let mut child = std::process::Command::new(exe)
        .args(shard_args(argv, k, n, want_frames))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .context("starting a render process")?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    // the last stderr line is the stats JSON; anything else is passed on (and kept for an error)
    let errs = std::thread::spawn(move || {
        let (mut text, mut stats) = (String::new(), None);
        for line in std::io::BufReader::new(stderr).lines().map_while(|l| l.ok()) {
            match serde_json::from_str::<Value>(&line) {
                Ok(v) if v.is_object() => stats = Some(v),
                _ => {
                    eprintln!("{}", line);
                    text.push_str(line.trim_start_matches("motion-render: "));
                    text.push('\n');
                }
            }
        }
        (text, stats)
    });
    Ok(std::thread::Builder::new().name(format!("render-proc-{}", k)).spawn(move || -> Result<Timing> {
        let mut rd = std::io::BufReader::with_capacity(1 << 20, stdout);
        let mut short = false;
        if want_frames {
            for j in 0..count {
                let mut head = [0u8; 8];
                if rd.read_exact(&mut head).is_err() {
                    short = true;
                    break;
                }
                let w = u32::from_le_bytes(head[..4].try_into().unwrap()) as i32;
                let h = u32::from_le_bytes(head[4..].try_into().unwrap()) as i32;
                let mut frame = vec![0u8; (w as usize) * (h as usize) * 4];
                if rd.read_exact(&mut frame).is_err() {
                    short = true;
                    break;
                }
                if tx.send(Ok((k + j * n, w, h, frame))).is_err() {
                    // the caller stopped (its encoder failed)
                    let _ = child.kill();
                    break;
                }
            }
        }
        let st = child.wait()?;
        let (text, stats) = errs.join().unwrap_or_default();
        if !st.success() || short {
            let _ = child.kill();
            let why = if text.trim().is_empty() { format!("exited with {}", st) } else { text.trim().to_string() };
            let e = anyhow!("render process {} of {}: {}", k + 1, n, why);
            let _ = tx.send(Err(anyhow!("{:#}", e)));
            return Err(e);
        }
        let s = stats.unwrap_or_default();
        let f = |key: &str| s[key].as_f64().unwrap_or(0.0);
        let frames = s["frames"].as_u64().unwrap_or(0) as usize;
        Ok(Timing { setup_ms: f("setup_ms"), draw_ms: f("draw_ms_per_frame") * frames as f64, write_ms: f("write_ms_per_frame") * frames as f64, frames })
    })?)
}

/// Render `times` across workers. Worker k takes frames k, k+n, k+2n…; with ffmpeg the main
/// thread pulls them back in order through one small queue per worker. Workers are threads, or
/// processes (use_processes) that each run this with one thread and a shard.
fn run(plan: Plan) -> Result<Value> {
    // a worker process renders frames first, first+step… of the whole plan on one thread
    let (first, step) = plan.shard.unwrap_or((0, 1));
    let order: Vec<usize> = (first..plan.times.len()).step_by(step).collect();
    let n = if plan.shard.is_some() { 1 } else { plan.workers.max(1).min(plan.times.len().max(1)) };
    let webgl = plan.page.scripts.iter().any(|s| asks_for_webgl(&s.code));
    let procs = plan.shard.is_none() && use_processes(std::env::var("MOTION_RENDER_GL").ok().as_deref(), std::env::var("MOTION_RENDER_PROCESSES").ok().as_deref(), webgl, n);
    let framed = plan.shard.is_some();
    let t0 = Instant::now();
    let page = Arc::new(plan.page);
    let times = Arc::new(plan.times);
    let want_frames = plan.ffmpeg.is_some() || plan.stream.is_some();
    let mut handles = vec![];
    let mut receivers = vec![];
    for k in 0..n {
        let (tx, rx) = mpsc::sync_channel::<Frame>(3);
        receivers.push(rx);
        if procs {
            let count = (k..times.len()).step_by(n).count();
            handles.push(spawn_shard(&plan.argv, k, n, count, want_frames, tx)?);
            continue;
        }
        let page = page.clone();
        let times = times.clone();
        let sink = plan.sink.clone();
        let job = plan.job.clone();
        let mode = plan.mode;
        let size = plan.size;
        handles.push(
            std::thread::Builder::new()
                .name(format!("render-{}", k))
                .stack_size(16 << 20)
                .spawn(move || -> Result<Timing> {
                    let mut tm = Timing::default();
                    let s0 = Instant::now();
                    let setup = (|| -> Result<Engine> {
                        let mut e = Engine::new(&page, mode, size)?;
                        e.setup(job.as_deref())?;
                        Ok(e)
                    })();
                    let mut engine = match setup {
                        Ok(e) => e,
                        Err(e) => {
                            let msg = format!("{:#}", e);
                            let _ = tx.send(Err(anyhow!("{}", msg)));
                            bail!("{}", msg);
                        }
                    };
                    tm.setup_ms = s0.elapsed().as_secs_f64() * 1000.0;
                    let mut buf = Vec::new();
                    let mut i = first + k * step;
                    while i < times.len() {
                        let d0 = Instant::now();
                        let (w, h) = match engine.render(times[i], &mut buf) {
                            Ok(v) => v,
                            Err(e) => {
                                let msg = format!("{:#}", e);
                                let _ = tx.send(Err(anyhow!("{}", msg)));
                                bail!("{}", msg);
                            }
                        };
                        tm.draw_ms += d0.elapsed().as_secs_f64() * 1000.0;
                        let w0 = Instant::now();
                        match &sink {
                            Sink::Png { dir, names } => write_png(&dir.join(&names[i]), w, h, &buf)?,
                            Sink::Rgba { dir, names } => std::fs::write(dir.join(&names[i]), &buf)?,
                            Sink::None => {}
                        }
                        tm.write_ms += w0.elapsed().as_secs_f64() * 1000.0;
                        tm.frames += 1;
                        if want_frames {
                            let frame = std::mem::take(&mut buf);
                            if tx.send(Ok((i, w, h, frame))).is_err() {
                                break;
                            }
                        }
                        i += n * step;
                    }
                    Ok(tm)
                })?,
        );
    }
    let mut encode_ms = 0.0;
    let mut ff_error = None;
    if let Some(target) = &plan.stream {
        // Frames in order, straight RGBA, to a file / FIFO / stdout. Opening a FIFO blocks until
        // its reader (the caller's encoder) is there, so open only once the first frame is drawn.
        let mut sink: Option<Box<dyn Write>> = None;
        for (j, &i) in order.iter().enumerate() {
            let (_, w, h, frame) = match receivers[j % n].recv() {
                Ok(Ok(v)) => v,
                Ok(Err(e)) => {
                    ff_error = Some(e);
                    break;
                }
                Err(_) => {
                    ff_error = Some(anyhow!("a render worker stopped"));
                    break;
                }
            };
            if sink.is_none() {
                sink = Some(if target == "-" {
                    Box::new(std::io::BufWriter::with_capacity(1 << 20, std::io::stdout().lock()))
                } else {
                    Box::new(std::fs::OpenOptions::new().write(true).open(target).with_context(|| format!("opening stream {}", target))?)
                });
            }
            let e0 = Instant::now();
            // a worker process tells its parent each frame's size
            let head = if framed { [(w as u32).to_le_bytes(), (h as u32).to_le_bytes()].concat() } else { vec![] };
            if let Err(e) = sink.as_mut().unwrap().write_all(&head).and_then(|_| sink.as_mut().unwrap().write_all(&frame)) {
                ff_error = Some(anyhow!("writing frame {} to the stream: {} (did the encoder stop?)", i, e));
                break;
            }
            encode_ms += e0.elapsed().as_secs_f64() * 1000.0;
        }
        if let Some(mut s) = sink {
            if let Err(e) = s.flush() {
                if ff_error.is_none() {
                    ff_error = Some(anyhow!("flushing the stream: {}", e));
                }
            }
        }
    } else if let Some((out, quality, fps)) = &plan.ffmpeg {
        let mut child: Option<std::process::Child> = None;
        for j in 0..order.len() {
            let msg = receivers[j % n].recv();
            let (_, w, h, frame) = match msg {
                Ok(Ok(v)) => v,
                Ok(Err(e)) => {
                    ff_error = Some(e);
                    break;
                }
                Err(_) => {
                    ff_error = Some(anyhow!("a render worker stopped"));
                    break;
                }
            };
            if child.is_none() {
                let (preset, crf) = x264(quality);
                child = Some(
                    std::process::Command::new("ffmpeg")
                        .args(["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", &format!("{}x{}", w, h), "-framerate", &fps.to_string(), "-i", "-"])
                        .args(["-vf", "scale=out_color_matrix=bt709,format=yuv420p", "-c:v", "libx264", "-preset", preset, "-crf", crf])
                        .args(["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart"])
                        .arg(out)
                        .stdin(std::process::Stdio::piped())
                        .spawn()
                        .context("starting ffmpeg")?,
                );
            }
            let e0 = Instant::now();
            child.as_mut().unwrap().stdin.as_mut().unwrap().write_all(&frame).context("writing to ffmpeg")?;
            encode_ms += e0.elapsed().as_secs_f64() * 1000.0;
        }
        if let Some(mut c) = child {
            drop(c.stdin.take());
            let e0 = Instant::now();
            let st = c.wait()?;
            encode_ms += e0.elapsed().as_secs_f64() * 1000.0;
            if !st.success() && ff_error.is_none() {
                ff_error = Some(anyhow!("ffmpeg exited with {}", st));
            }
        }
    } else {
        // drain errors
        for rx in &receivers {
            if let Ok(Err(e)) = rx.try_recv() {
                ff_error = Some(e);
            }
        }
    }
    drop(receivers);
    let mut timings = vec![];
    for h in handles {
        match h.join() {
            Ok(Ok(t)) => timings.push(t),
            Ok(Err(e)) => {
                if ff_error.is_none() {
                    ff_error = Some(e);
                }
            }
            Err(_) => {
                if ff_error.is_none() {
                    ff_error = Some(anyhow!("a render worker panicked"));
                }
            }
        }
    }
    if let Some(e) = ff_error {
        return Err(e);
    }
    let wall = t0.elapsed().as_secs_f64() * 1000.0;
    let frames: usize = timings.iter().map(|t| t.frames).sum();
    let draw: f64 = timings.iter().map(|t| t.draw_ms).sum();
    let write: f64 = timings.iter().map(|t| t.write_ms).sum();
    let setup = timings.iter().map(|t| t.setup_ms).fold(0.0, f64::max);
    Ok(json!({
        "frames": frames,
        "workers": n,
        "processes": procs,
        "wall_ms": wall,
        "setup_ms": setup,
        "draw_ms_per_frame": if frames > 0 { draw / frames as f64 } else { 0.0 },
        "write_ms_per_frame": if frames > 0 { write / frames as f64 } else { 0.0 },
        "wall_ms_per_frame": if frames > 0 { (wall - setup) / frames as f64 } else { 0.0 },
        "encode_wait_ms": encode_ms,
    }))
}

fn parse_range(s: &str) -> Result<(i64, i64)> {
    let (a, b) = s.split_once('-').ok_or_else(|| anyhow!("--frames takes a-b"))?;
    Ok((a.trim().parse()?, b.trim().parse()?))
}

/// The film config a page carries (#film-config), for fps.
fn page_fps(page: &page::Page) -> Option<f64> {
    let cfg = page.elements.iter().find(|e| e.id == "film-config")?;
    let v: Value = serde_json::from_str(&cfg.text).ok()?;
    v["fps"].as_f64()
}

fn main() {
    if let Err(e) = real_main() {
        eprintln!("motion-render: {:#}", e);
        std::process::exit(1);
    }
}

fn real_main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "-h" || a == "--help") || args.is_empty() && std::env::var("MOTION_USE_JOB").is_err() {
        print!("{}", USAGE);
        return Ok(());
    }
    if args.iter().any(|a| a == "--version") {
        println!("motion-render {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    // --gl <backend> is MOTION_RENDER_GL (auto, gpu, metal, vulkan, swiftshader, d3d11, off), set
    // before any thread starts
    if let Some(k) = args.iter().position(|a| a == "--gl") {
        let v = args.get(k + 1).ok_or_else(|| anyhow!("--gl needs a value"))?;
        std::env::set_var("MOTION_RENDER_GL", v);
    }
    if args.iter().any(|a| a == "--capabilities") {
        // webgl: whether ANGLE loads and makes a context here (motion-use routes WebGL films by it)
        let gl = webgl::probe();
        let mut caps = json!({"version": env!("CARGO_PKG_VERSION"), "canvas2d": true, "webgl": gl.is_ok(), "stream": true, "probe": true, "job_stream": true, "footage": true});
        match gl {
            Ok((backend, dir)) => caps["gl"] = json!({"backend": backend, "angle": dir}),
            Err(e) => caps["webgl_error"] = json!(e),
        }
        println!("{}", caps);
        return Ok(());
    }
    let mut opts: std::collections::HashMap<String, String> = Default::default();
    let mut flags: std::collections::HashSet<String> = Default::default();
    let mut pos: Vec<String> = vec![];
    let mut i = 0;
    let valued = ["--gl", "--job", "--at", "--frames", "--fps", "--out", "--format", "--ffmpeg", "--quality", "--workers", "--size", "--stream", "--times", "--shard"];
    while i < args.len() {
        let a = &args[i];
        if valued.contains(&a.as_str()) {
            let v = args.get(i + 1).ok_or_else(|| anyhow!("{} needs a value", a))?;
            opts.insert(a.clone(), v.clone());
            i += 2;
        } else if a.starts_with("--") {
            flags.insert(a.clone());
            i += 1;
        } else {
            pos.push(a.clone());
            i += 1;
        }
    }
    let workers: usize = opts.get("--workers").map(|w| w.parse()).transpose()?.unwrap_or(1);
    let stats = flags.contains("--stats");
    // --shard k/n: this is worker process k of n (spawn_shard), its frames framed on stdout
    let shard = opts
        .get("--shard")
        .map(|s| -> Result<(usize, usize)> {
            let (k, n) = s.split_once('/').ok_or_else(|| anyhow!("--shard takes k/n"))?;
            Ok((k.parse()?, n.parse::<usize>()?.max(1)))
        })
        .transpose()?;
    let job_path = opts.get("--job").cloned().or_else(|| std::env::var("MOTION_USE_JOB").ok());

    if pos.first().map(|s| s.as_str()) == Some("probe") {
        let html = PathBuf::from(pos.get(1).ok_or_else(|| anyhow!("probe needs a page (index.html)"))?);
        let spec = opts.get("--times").ok_or_else(|| anyhow!("probe needs --times <t,t,...|times.json>"))?;
        let times: Vec<f64> = if spec.ends_with(".json") {
            serde_json::from_str(&std::fs::read_to_string(spec).with_context(|| format!("reading {}", spec))?)?
        } else {
            spec.split(',').filter(|t| !t.trim().is_empty()).map(|t| t.trim().parse::<f64>()).collect::<std::result::Result<_, _>>()?
        };
        let page = page::load_html(&html)?;
        let mut engine = Engine::new(&page, Mode::Film, None)?;
        engine.setup(None)?;
        let out = engine.text_probe(&serde_json::to_string(&times)?)?;
        println!("{}", out);
        return Ok(());
    }

    if pos.first().map(|s| s.as_str()) == Some("render") {
        let html = PathBuf::from(pos.get(1).ok_or_else(|| anyhow!("render needs a page (index.html)"))?);
        let engine = flags.contains("--engine");
        let page = page::load_html(&html)?;
        let job: Option<Value> = job_path.as_ref().map(|p| -> Result<Value> { Ok(serde_json::from_str(&std::fs::read_to_string(p)?)?) }).transpose()?;
        let fps = opts.get("--fps").map(|f| f.parse::<f64>()).transpose()?.or_else(|| page_fps(&page)).or_else(|| job.as_ref().and_then(|j| j["fps"].as_f64())).unwrap_or(30.0);
        let (times, names): (Vec<f64>, Vec<String>) = if let Some(at) = opts.get("--at") {
            let ts: Vec<f64> = at.split(',').map(|t| t.trim().parse::<f64>()).collect::<std::result::Result<_, _>>()?;
            let names = (0..ts.len()).map(|i| format!("{:05}", i)).collect();
            (ts, names)
        } else if let Some(r) = opts.get("--frames") {
            let (a, b) = parse_range(r)?;
            ((a..=b).map(|k| k as f64 / fps).collect(), (a..=b).map(|k| format!("{:05}", k)).collect())
        } else {
            bail!("render needs --at or --frames");
        };
        let format = opts.get("--format").map(|s| s.as_str()).unwrap_or("png");
        let sink = match opts.get("--out") {
            Some(dir) => {
                std::fs::create_dir_all(dir)?;
                let ext = if format == "rgba" { "rgba" } else { "png" };
                let names = Arc::new(names.iter().map(|n| format!("{}.{}", n, ext)).collect());
                if format == "rgba" {
                    Sink::Rgba { dir: dir.into(), names }
                } else {
                    Sink::Png { dir: dir.into(), names }
                }
            }
            None => Sink::None,
        };
        let size = job.as_ref().and_then(|j| Some((j["width"].as_i64()? as i32, j["height"].as_i64()? as i32)));
        let plan = Plan {
            page,
            mode: if engine { Mode::Engine } else { Mode::Film },
            job: job.as_ref().map(|j| j.to_string()),
            size,
            times,
            sink,
            ffmpeg: opts.get("--ffmpeg").map(|o| (PathBuf::from(o), opts.get("--quality").cloned().unwrap_or("looks".into()), fps)),
            stream: opts.get("--stream").cloned(),
            workers,
            stats,
            argv: args.clone(),
            shard,
        };
        let stats_on = plan.stats;
        // a worker process keeps stdout for frames (spawn_shard reads stats from stderr)
        let to_stdout = plan.stream.as_deref() == Some("-") || plan.shard.is_some();
        let r = run(plan)?;
        if stats_on {
            if to_stdout {
                eprintln!("{}", r);
            } else {
                println!("{}", r);
            }
        }
        return Ok(());
    }

    // ------------------------------------------------------------ external-engine job contract
    let job_path = job_path.ok_or_else(|| anyhow!("no job: pass --job <job.json> or set MOTION_USE_JOB"))?;
    let job: Value = serde_json::from_str(&std::fs::read_to_string(&job_path).with_context(|| format!("reading {}", job_path))?)?;
    let fps = job["fps"].as_f64().ok_or_else(|| anyhow!("job.fps missing"))?;
    let from = job["frames"]["from"].as_i64().ok_or_else(|| anyhow!("job.frames.from missing"))?;
    let to = job["frames"]["to"].as_i64().ok_or_else(|| anyhow!("job.frames.to missing"))?;
    let out = PathBuf::from(job["out"].as_str().ok_or_else(|| anyhow!("job.out missing"))?);
    std::fs::create_dir_all(&out)?;
    let pattern = job["pattern"].as_str().unwrap_or("%05d.png");
    if pattern != "%05d.png" {
        bail!("unsupported job pattern {} (expected %05d.png)", pattern);
    }
    let src = pos.first().ok_or_else(|| anyhow!("name the drawing: motion-render composition/draw.js --job <job.json> (or an engine .html page)"))?;
    let src_path = {
        let p = PathBuf::from(src);
        if p.is_absolute() {
            p
        } else {
            PathBuf::from(job["film"]["dir"].as_str().unwrap_or(".")).join(p)
        }
    };
    let (page, mode) = if src.ends_with(".html") { (page::load_html(&src_path)?, Mode::Engine) } else { (page::from_job(&job, &src_path)?, Mode::Film) };
    let names = Arc::new((from..=to).map(|k| format!("{:05}.png", k)).collect::<Vec<_>>());
    // motion-use offers a raw stream (a FIFO it encodes from) next to the PNG sequence.
    let job_stream = job["stream"].as_str().filter(|_| job["formats"].as_array().map(|f| f.iter().any(|x| x == "rgba-stream")).unwrap_or(false)).map(String::from);
    let format = opts.get("--format").map(|s| s.as_str()).unwrap_or("png");
    let sink = if job_stream.is_some() {
        Sink::None
    } else if format == "rgba" {
        Sink::Rgba { dir: out.clone(), names: Arc::new(names.iter().map(|n| n.replace(".png", ".rgba")).collect()) }
    } else {
        Sink::Png { dir: out.clone(), names }
    };
    let size = Some((job["width"].as_i64().unwrap_or(1920) as i32, job["height"].as_i64().unwrap_or(1080) as i32));
    let plan = Plan {
        page,
        mode,
        job: Some(job.to_string()),
        size,
        times: (from..=to).map(|k| k as f64 / fps).collect(),
        sink,
        ffmpeg: None,
        stream: job_stream,
        // --workers, else the job's (a parallel engine gets motion-use's --workers), else the cores
        workers: if opts.contains_key("--workers") {
            workers
        } else if let Some(w) = job["workers"].as_u64() {
            w.max(1) as usize
        } else {
            std::thread::available_parallelism().map(|n| n.get().min(8)).unwrap_or(4)
        },
        stats,
        argv: args.clone(),
        shard,
    };
    if shard.is_some() {
        // a worker process: frames to its parent on stdout (not job.stream, the parent's FIFO),
        // stats on stderr
        let to_parent = plan.stream.is_some();
        let plan = Plan { stream: to_parent.then(|| "-".to_string()), ..plan };
        let r = run(plan)?;
        eprintln!("{}", r);
        return Ok(());
    }
    let r = run(plan)?;
    eprintln!("motion-render: {} frames ({}–{}) in {:.0} ms, {:.1} ms/frame wall, {} workers", r["frames"], from, to, r["wall_ms"].as_f64().unwrap_or(0.0), r["wall_ms_per_frame"].as_f64().unwrap_or(0.0), r["workers"]);
    if stats {
        println!("{}", r);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{asks_for_webgl, shard_args, use_processes};

    #[test]
    fn webgl_on_the_gpu_uses_processes() {
        for gl in [None, Some(""), Some(" Auto "), Some("gpu"), Some("metal"), Some("vulkan"), Some("d3d11")] {
            assert!(use_processes(gl, None, true, 8), "{gl:?}");
            assert!(!use_processes(gl, None, true, 1), "{gl:?}");
            assert!(!use_processes(gl, None, false, 8), "{gl:?}");
        }
        for gl in ["swiftshader", "cpu", "software", "off", "none"] {
            assert!(!use_processes(Some(gl), None, true, 8), "{gl}");
        }
        assert!(!use_processes(None, Some("0"), true, 8));
        assert!(use_processes(Some("swiftshader"), Some("1"), false, 8));
        assert!(!use_processes(Some("swiftshader"), Some("1"), false, 1));
    }

    #[test]
    fn webgl_pages_are_recognised() {
        assert!(asks_for_webgl(r#"c.getContext("webgl2", {antialias: false})"#));
        assert!(asks_for_webgl("N===null){let D=\"webgl2\";if(N=We(D"));
        assert!(asks_for_webgl("getContext('experimental-webgl')"));
        assert!(!asks_for_webgl("// A WebGL author can draw its offscreen renderer into ctx"));
        assert!(!asks_for_webgl(r#"c.getContext("2d")"#));
    }

    #[test]
    fn a_worker_process_gets_one_thread_and_its_shard() {
        let argv: Vec<String> = ["render", "p.html", "--frames", "0-9", "--workers", "4", "--ffmpeg", "o.mp4", "--quality", "looks", "--stats", "--gl", "metal"].map(String::from).into();
        assert_eq!(shard_args(&argv, 2, 4, true), ["render", "p.html", "--frames", "0-9", "--gl", "metal", "--workers", "1", "--shard", "2/4", "--stats", "--stream", "-"]);
        let argv: Vec<String> = ["render", "p.html", "--frames", "0-9", "--out", "d", "--workers", "4"].map(String::from).into();
        assert_eq!(shard_args(&argv, 0, 4, false), ["render", "p.html", "--frames", "0-9", "--out", "d", "--workers", "1", "--shard", "0/4", "--stats"]);
    }
}

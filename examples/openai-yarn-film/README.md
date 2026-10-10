# 毛线接力 · OpenAI（three.js 示例）

六只毛毡小怪物接力推一个白毛线球，放下的线织成 OpenAI 的标志；毛线膨胀成毛绒管、标志立起；熄灯后六色光沿线跑、合成白光；最后闪光灯合影。40 秒，60fps，配乐和音效全部由代码合成。

成片：[../../media/openai-yarn-film.mp4](../../media/openai-yarn-film.mp4) · 导演记录：[DIRECTOR.md](DIRECTOR.md)

这个示例展示 motion-use 加载本地浏览器打包（`film.json` 的 `libraries`）：`src/scene.js` 是一个 three.js 场景（毛毡 sheen 材质加半透明绒毛壳层、镜面地板、按 shader 控制铺设/膨胀/发光的毛线管、Bloom），每一帧都是时间的纯函数；`composition/draw.js` 把 WebGL 画面合成进 canvas，并画闪光和宝丽来。

```bash
cd examples/openai-yarn-film
npm install && npm run build          # three.js 场景 → vendor/scene.js
python3 audio/score.py                # numpy/scipy 合成配乐和音效 → audio/score.wav
motion-use still . --allow-code --gpu --at 6,24.5,29
motion-use render . --allow-code --gpu --quality high
```

`--gpu` 用硬件 WebGL，速度快，但不同机器之间帧可能有肉眼不可见的差异；软件渲染可以逐帧一致，只是很慢。

非官方作品，与 OpenAI 无关联。OpenAI 名称和标志是 OpenAI 的商标；标志路径是按其公开符号 SVG 测量拟合的中心线。

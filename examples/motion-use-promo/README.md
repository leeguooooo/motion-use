# motion-use 推广片（three.js，带旁白）

102 秒，60fps，中文旁白和烧录字幕。一条发光的时间线贯穿全片，依次讲 motion-use 的原理和能力：agent 写导演稿 → 画面是时间的函数 → 浏览器逐帧定位、多进程并行截帧 → 字体子集、离线渲染 → 旁白必须装进镜头 → 交付前实测成片，但要有人看过才算通过 → 一份导演稿出多种画幅。导演记录见 [DIRECTOR.md](DIRECTOR.md)。

https://github.com/user-attachments/assets/2878c92d-10d5-4577-8cd7-ad5d0d8bd2b5


```bash
cd examples/motion-use-promo
npm install && npm run build          # three.js 场景 → vendor/scene.js
python3 audio/score.py                # 合成配乐和音效 → audio/score.wav
motion-use voiceover .                # 生成中文旁白（edge-tts，预览用途）
motion-use render . --allow-code --gpu --quality high
```

`--gpu` 用硬件 WebGL，快，但不同机器之间帧可能有肉眼不可见的差异。字幕时间表在 `film.json` 的 `copy.subs`，按每段旁白的实测时长生成，改了旁白要重新生成。

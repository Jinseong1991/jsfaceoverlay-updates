# 외부 AI(ChatGPT 이미지 생성, Adobe Firefly 등)로 로고를 만들 때 쓰는 프롬프트

아래 내용을 그대로 붙여넣으세요. `icon-1024.png` 를 참고 이미지로 함께 올리면 방향이 더 잘 맞아요.

## 앱 아이콘
```
Design a premium, minimal app icon for an AI named "Jinyu".
Concept: the name combines the creator's name "Jinseong" (Jin) and "Freedom" (yu, 自由).
Symbol: a single elegant letter "J" whose top stroke flows seamlessly into a tapered, rising wing,
flying toward a small golden sun in the upper right.
Style: flat vector, geometric, clean negative space, no text, no 3D, no clutter, Apple/Stripe-level polish.
Background: rounded square with a deep night-to-dawn gradient (#0F0C2E → #25236E → #1667A8),
soft light from the upper right.
Colors: white J, wing in white→aurora mint (#8FF0DD) with a second smaller teal feather (#4FD1C5),
sun in gold (#FBBF24).
Must stay recognizable at 32px. 1024x1024.
```

## 가로 로고 (워드마크)
```
Horizontal logo lockup: the Jinyu app icon on the left, the word "Jinyu" in a modern geometric sans-serif
(semi-bold, tight letter spacing, dark navy #0F0C2E) on the right,
with a small widely-spaced tagline below: "FREEDOM · BY JINSEONG" in ocean blue (#1667A8).
White background, generous whitespace, minimal, premium tech brand. 2160x800.
```

## 내 PC의 Stable Diffusion (ComfyUI / Fooocus / WebUI, SDXL 계열 모델)
- 크기 1024x1024, Steps 30, CFG 6~7
- `icon-1024.png` 를 img2img(또는 ControlNet Canny/Lineart, 강도 0.5~0.7)에 넣으면 형태를 유지한 채 질감만 고급스럽게 바뀌어요.

Prompt:
```
minimal premium app icon, single elegant white letter J whose top stroke flows into a tapered rising wing,
small golden sun in upper right, rounded square, deep navy to dawn blue gradient background,
aurora mint and teal wing feathers, flat vector logo, geometric, clean negative space,
dribbble, behance, apple design award, centered, high detail, sharp edges
```

Negative prompt:
```
text, letters other than J, watermark, signature, 3d render, photo, realistic, noisy, cluttered,
multiple wings, extra objects, blurry, low quality, jpeg artifacts, gradient banding
```

/* 툰헬퍼 캐릭터 파츠 (04). 512×512 좌표계, 얼굴 중심 (256, 300).
 * 색 치환 클래스: c-hair, c-skin, c-clothes, c-accent. 레이어 순서 = layers 배열 순서.
 * 실제 상품에서는 작가가 그린 파츠로 교체한다. 규칙: 같은 viewBox, 같은 얼굴 기준점, 앞머리는 눈 위 레이어.
 */
window.TH_PARTS = {
  size: 512,
  layers: ["hairBack", "body", "clothes", "head", "eyes", "mouth", "hairFront", "accessory"],
  layerLabels: { hairBack: "뒷머리", body: "체형", clothes: "옷", head: "얼굴형", eyes: "눈", mouth: "입", hairFront: "앞머리", accessory: "소품" },
  parts: {
    hairBack: [
      { id: "hb0", label: "없음", svg: "" },
      { id: "hb1", label: "긴 생머리", svg: '<path class="c-hair" d="M112 300 Q112 150 256 150 Q400 150 400 300 L408 500 L104 500 Z"/>' },
      { id: "hb2", label: "단발 뒷머리", svg: '<path class="c-hair" d="M118 300 Q118 160 256 160 Q394 160 394 300 L398 420 Q256 440 114 420 Z"/>' },
      { id: "hb3", label: "양갈래", svg: '<path class="c-hair" d="M126 300 Q126 160 256 160 Q386 160 386 300 L386 360 L126 360 Z"/><ellipse class="c-hair" cx="118" cy="400" rx="34" ry="90"/><ellipse class="c-hair" cx="394" cy="400" rx="34" ry="90"/>' },
      { id: "hb4", label: "포니테일", svg: '<path class="c-hair" d="M126 300 Q126 160 256 160 Q386 160 386 300 L386 360 L126 360 Z"/><path class="c-hair" d="M370 240 Q440 260 430 420 Q410 480 380 440 Q400 330 360 300 Z"/>' },
      { id: "hb5", label: "웨이브 긴머리", svg: '<path class="c-hair" d="M112 300 Q112 150 256 150 Q400 150 400 300 Q420 380 396 440 Q412 490 380 500 L132 500 Q100 490 116 440 Q92 380 112 300 Z"/>' }
    ],
    body: [
      { id: "b1", label: "기본", svg: '<rect class="c-skin" x="226" y="400" width="60" height="60" rx="18"/>' },
      { id: "b2", label: "통통", svg: '<rect class="c-skin" x="216" y="400" width="80" height="60" rx="24"/>' }
    ],
    clothes: [
      { id: "c1", label: "티셔츠", svg: '<path class="c-clothes" d="M150 512 L170 432 Q256 402 342 432 L362 512 Z"/>' },
      { id: "c2", label: "후드티", svg: '<path class="c-clothes" d="M142 512 L166 428 Q256 396 346 428 L370 512 Z"/><path class="c-clothes" d="M196 436 Q256 470 316 436 Q300 418 256 414 Q212 418 196 436 Z" stroke="#222" stroke-opacity=".25" stroke-width="4"/><path d="M240 450 L236 500 M272 450 L276 500" stroke="#fff" stroke-width="5" stroke-linecap="round"/>' },
      { id: "c3", label: "셔츠", svg: '<path class="c-clothes" d="M150 512 L170 432 Q256 402 342 432 L362 512 Z"/><path d="M226 424 L256 466 L286 424 L270 416 L256 440 L242 416 Z" fill="#fff"/><rect x="253" y="462" width="6" height="50" fill="#fff" opacity=".7"/>' },
      { id: "c4", label: "원피스", svg: '<path class="c-clothes" d="M130 512 L176 428 Q256 400 336 428 L382 512 Z"/><path d="M176 470 L336 470" stroke="#fff" stroke-width="5" opacity=".6"/>' },
      { id: "c5", label: "재킷", svg: '<path class="c-clothes" d="M146 512 L168 430 Q256 400 344 430 L366 512 Z"/><path d="M216 428 L256 512 L296 428 L278 420 L256 470 L234 420 Z" fill="#fff"/><path class="c-accent" d="M250 434 L262 434 L266 480 L256 496 L246 480 Z"/>' },
      { id: "c6", label: "줄무늬 티", svg: '<path class="c-clothes" d="M150 512 L170 432 Q256 402 342 432 L362 512 Z"/><path d="M166 452 L346 452 M160 478 L352 478 M156 504 L356 504" stroke="#fff" stroke-width="9" opacity=".8"/>' },
      { id: "c7", label: "멜빵", svg: '<path class="c-clothes" d="M150 512 L170 432 Q256 402 342 432 L362 512 Z" fill="#fff" style="fill:#fff"/><path class="c-accent" d="M150 512 L160 468 L352 468 L362 512 Z"/><path class="c-accent" d="M196 420 L212 468 L232 468 L214 416 Z M316 420 L300 468 L280 468 L298 416 Z"/>' }
    ],
    head: [
      { id: "h1", label: "동그란 얼굴", svg: '<circle class="c-skin" cx="256" cy="300" r="130"/><ellipse cx="176" cy="332" rx="20" ry="11" fill="#f7a8a8" opacity=".7"/><ellipse cx="336" cy="332" rx="20" ry="11" fill="#f7a8a8" opacity=".7"/>' },
      { id: "h2", label: "갸름한 얼굴", svg: '<ellipse class="c-skin" cx="256" cy="302" rx="122" ry="134"/><ellipse cx="180" cy="334" rx="18" ry="10" fill="#f7a8a8" opacity=".7"/><ellipse cx="332" cy="334" rx="18" ry="10" fill="#f7a8a8" opacity=".7"/>' },
      { id: "h3", label: "볼살 얼굴", svg: '<path class="c-skin" d="M126 290 Q126 170 256 170 Q386 170 386 290 Q386 430 256 432 Q126 430 126 290 Z"/><ellipse cx="172" cy="340" rx="24" ry="13" fill="#f7a8a8" opacity=".75"/><ellipse cx="340" cy="340" rx="24" ry="13" fill="#f7a8a8" opacity=".75"/>' }
    ],
    eyes: [
      { id: "e-basic", expr: "basic", label: "기본", svg: '<circle cx="206" cy="290" r="14" fill="#222"/><circle cx="306" cy="290" r="14" fill="#222"/><circle cx="211" cy="285" r="4" fill="#fff"/><circle cx="311" cy="285" r="4" fill="#fff"/>' },
      { id: "e-smile", expr: "smile", label: "웃음", svg: '<path d="M186 294 Q206 272 226 294" stroke="#222" stroke-width="10" fill="none" stroke-linecap="round"/><path d="M286 294 Q306 272 326 294" stroke="#222" stroke-width="10" fill="none" stroke-linecap="round"/>' },
      { id: "e-surprise", expr: "surprise", label: "놀람", svg: '<circle cx="206" cy="290" r="22" fill="#fff" stroke="#222" stroke-width="6"/><circle cx="206" cy="290" r="9" fill="#222"/><circle cx="306" cy="290" r="22" fill="#fff" stroke="#222" stroke-width="6"/><circle cx="306" cy="290" r="9" fill="#222"/>' },
      { id: "e-sad", expr: "sad", label: "울상", svg: '<path d="M186 284 Q206 300 226 290" stroke="#222" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M286 290 Q306 300 326 284" stroke="#222" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M190 266 L224 276 M322 266 L288 276" stroke="#222" stroke-width="7" stroke-linecap="round"/>' },
      { id: "e-angry", expr: "angry", label: "분노", svg: '<circle cx="206" cy="292" r="12" fill="#222"/><circle cx="306" cy="292" r="12" fill="#222"/><path d="M184 262 L228 278 M328 262 L284 278" stroke="#222" stroke-width="8" stroke-linecap="round"/>' },
      { id: "e-blank", expr: "blank", label: "무표정", svg: '<path d="M190 290 L222 290 M290 290 L322 290" stroke="#222" stroke-width="9" stroke-linecap="round"/>' },
      { id: "e-wink", expr: "wink", label: "윙크", svg: '<circle cx="206" cy="290" r="14" fill="#222"/><circle cx="211" cy="285" r="4" fill="#fff"/><path d="M286 290 Q306 302 326 290" stroke="#222" stroke-width="9" fill="none" stroke-linecap="round"/>' }
    ],
    mouth: [
      { id: "m-basic", expr: "basic", label: "기본", svg: '<path d="M236 356 Q256 374 276 356" stroke="#222" stroke-width="8" fill="none" stroke-linecap="round"/>' },
      { id: "m-smile", expr: "smile", label: "활짝", svg: '<path d="M222 350 Q256 392 290 350 Z" fill="#222"/><path d="M234 356 Q256 376 278 356 Z" fill="#f77"/>' },
      { id: "m-open", expr: "surprise", label: "놀람", svg: '<ellipse cx="256" cy="362" rx="18" ry="26" fill="#222"/>' },
      { id: "m-sad", expr: "sad", label: "울상", svg: '<path d="M232 368 Q256 346 280 368" stroke="#222" stroke-width="8" fill="none" stroke-linecap="round"/>' },
      { id: "m-angry", expr: "angry", label: "이 악물", svg: '<path d="M226 360 L286 360" stroke="#222" stroke-width="9" stroke-linecap="round"/><path d="M236 354 L236 366 M248 354 L248 366 M264 354 L264 366 M276 354 L276 366" stroke="#fff" stroke-width="4"/>' },
      { id: "m-blank", expr: "blank", label: "일자", svg: '<path d="M240 362 L272 362" stroke="#222" stroke-width="8" stroke-linecap="round"/>' },
      { id: "m-wink", expr: "wink", label: "메롱", svg: '<path d="M232 352 Q256 378 280 352" stroke="#222" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M248 364 Q256 386 268 364 Z" fill="#f77"/>' }
    ],
    hairFront: [
      { id: "hf1", label: "둥근 앞머리", svg: '<path class="c-hair" d="M126 300 Q126 170 256 170 Q386 170 386 300 Q330 230 256 240 Q182 230 126 300 Z"/>' },
      { id: "hf2", label: "양옆 볼륨", svg: '<path class="c-hair" d="M120 320 Q120 160 256 160 Q392 160 392 320 L392 250 Q350 200 256 210 Q162 200 120 250 Z"/><circle class="c-hair" cx="140" cy="280" r="34"/><circle class="c-hair" cx="372" cy="280" r="34"/>' },
      { id: "hf3", label: "삐죽 앞머리", svg: '<path class="c-hair" d="M126 300 Q140 150 256 160 Q372 150 386 300 L386 260 Q320 190 300 250 Q270 200 220 250 Q190 200 126 260 Z"/>' },
      { id: "hf4", label: "가르마", svg: '<path class="c-hair" d="M126 300 Q126 166 256 166 Q386 166 386 300 L386 250 Q330 200 290 236 Q276 214 270 190 Q210 200 126 270 Z"/>' },
      { id: "hf5", label: "짧은 머리", svg: '<path class="c-hair" d="M130 280 Q130 172 256 168 Q382 172 382 280 Q340 216 256 214 Q172 216 130 280 Z"/>' },
      { id: "hf6", label: "뾰족 머리", svg: '<path class="c-hair" d="M126 300 Q126 170 256 170 Q386 170 386 300 L386 260 Q350 220 320 250 L300 180 L270 240 L256 150 L240 240 L214 180 L196 250 Q166 220 126 260 Z"/>' },
      { id: "hf7", label: "곱슬 앞머리", svg: '<path class="c-hair" d="M126 300 Q126 170 256 170 Q386 170 386 300 Q330 230 256 240 Q182 230 126 300 Z"/><circle class="c-hair" cx="150" cy="210" r="30"/><circle class="c-hair" cx="200" cy="180" r="30"/><circle class="c-hair" cx="256" cy="168" r="32"/><circle class="c-hair" cx="312" cy="180" r="30"/><circle class="c-hair" cx="362" cy="210" r="30"/>' },
      { id: "hf8", label: "모자 눌린 머리", svg: '<path class="c-hair" d="M126 300 Q126 190 256 190 Q386 190 386 300 Q330 250 256 254 Q182 250 126 300 Z"/>' }
    ],
    accessory: [
      { id: "a0", label: "없음", svg: "" },
      { id: "a-glasses", label: "동그란 안경", svg: '<circle cx="206" cy="292" r="34" fill="none" stroke="#333" stroke-width="7"/><circle cx="306" cy="292" r="34" fill="none" stroke="#333" stroke-width="7"/><path d="M240 292 L272 292" stroke="#333" stroke-width="7"/>' },
      { id: "a-glasses2", label: "네모 안경", svg: '<rect x="170" y="266" width="70" height="52" rx="10" fill="none" stroke="#333" stroke-width="7"/><rect x="272" y="266" width="70" height="52" rx="10" fill="none" stroke="#333" stroke-width="7"/><path d="M240 290 L272 290" stroke="#333" stroke-width="7"/>' },
      { id: "a-cap", label: "캡모자", svg: '<path class="c-accent" d="M118 250 Q118 140 256 140 Q394 140 394 250 Z"/><path class="c-accent" d="M110 250 L420 250 L440 268 L100 268 Z"/>' },
      { id: "a-pin", label: "머리핀", svg: '<path class="c-accent" d="M318 196 L356 214 L352 226 L314 208 Z"/><circle class="c-accent" cx="358" cy="220" r="10"/>' },
      { id: "a-headphone", label: "헤드폰", svg: '<path d="M126 300 Q126 160 256 160 Q386 160 386 300" stroke="#333" stroke-width="12" fill="none"/><rect x="112" y="270" width="36" height="70" rx="12" fill="#333"/><rect x="364" y="270" width="36" height="70" rx="12" fill="#333"/>' },
      { id: "a-bow", label: "리본", svg: '<path class="c-accent" d="M330 190 L370 170 L366 212 Z M330 190 L300 168 L296 210 Z"/><circle class="c-accent" cx="330" cy="190" r="10"/>' },
      { id: "a-mask", label: "마스크", svg: '<path d="M176 330 Q256 420 336 330 L336 344 Q256 436 176 344 Z" fill="#fff" stroke="#bbb" stroke-width="4"/><path d="M176 334 L140 320 M336 334 L372 320" stroke="#bbb" stroke-width="5"/>' }
    ]
  },
  palettes: {
    hair: ["#2b2b2b", "#5b3a2e", "#8c5a3c", "#e0a84f", "#c45c7a", "#4e6bd1", "#8f8f8f", "#3f8f6b"],
    skin: ["#ffe6d5", "#f6d3b8", "#eac2a0", "#d9a98a"],
    clothes: ["#4e6bd1", "#3f8f6b", "#e07a5f", "#8f8f8f", "#f2c14e", "#2b2b2b", "#7b5cd6", "#e9a3c9"],
    accent: ["#f2c14e", "#e07a5f", "#4e6bd1", "#c45c7a", "#2b2b2b"]
  },
  paletteLabels: { hair: "머리색", skin: "피부색", clothes: "옷 색", accent: "포인트 색" },
  exprs: [
    { id: "basic", label: "기본" }, { id: "smile", label: "웃음" }, { id: "surprise", label: "놀람" },
    { id: "sad", label: "울상" }, { id: "angry", label: "분노" }, { id: "blank", label: "무표정" }, { id: "wink", label: "윙크" }
  ],
  names: ["나", "지우", "하늘", "보라", "민준", "서연", "도윤", "하린", "콩이", "모모", "쭈니", "별이", "구름", "토리", "봄", "여름", "단비", "솔", "루이", "밤톨"]
};

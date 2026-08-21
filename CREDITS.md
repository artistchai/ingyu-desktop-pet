# CREDITS

이 프로젝트(인규 데스크탑 펫)를 만들면서 사용한 폰트, 3D 모델, 이미지 등 외부 리소스의 출처와 라이선스를 정리한 문서입니다.

---

## 폰트 (Fonts)

### GalmuriMono11

- **제작자**: © 2019–2025 Lee Minseo ([quiple@quiple.dev](mailto:quiple@quiple.dev))
- **출처(다운로드 페이지)**: https://quiple.dev/font/galmuri
- **라이선스**: SIL Open Font License 1.1
- **라이선스 원문**: https://github.com/quiple/galmuri/blob/main/ofl.md
- **비고**: 앱 내 픽셀 폰트 표시(타이머, 생각풍선 텍스트 등)에 사용

---

## 3D 모델 (3D Assets)

### 인규 캐릭터 모델 (character.glb, character2.glb)

- **원본 제작**: Tripo AI (Pro 요금제)
- **리깅 도구**: 직접 리깅 (Blender)

### 가구 에셋 (furniture.glb — 책상, 의자, 노트북, 마우스, 커피 등)

- **생성 도구**: Tripo AI (Pro 요금제)
- **원본 소스**: 각 오브젝트를 개별 생성 후 Blender에서 조립
- **Tripo AI 이용약관**: https://www.tripo3d.ai/ko/terms (2025년 7월 11일 최종 갱신본 기준)
- **근거 조항**: 약관 5.2.2 "Paid Users" — 유료(Pro) 사용자는 자신이 생성한 Input/Output 및 그로부터 파생된 지식재산권에 대해 사용·복제·수정·배포·상업적 수익화를 포함한 권리를 일반적으로 보유함
- **비고**: 위 조항에 따라 Pro 요금제로 생성한 본 프로젝트의 3D 모델은 상업적 이용 및 배포에 문제가 없는 것으로 확인됨(2026-08-20 확인). 다만 약관은 회사 재량으로 변경될 수 있으므로, 정식 출시 전 최신 약관을 한 번 더 대조 확인 권장.

### 이불+베개 모델 (bedding_pillow.glb)

- **생성 도구**: Tripo AI

---

## 이미지 / 로고

### CHAI 로고

- **소유**: 당사(회사명) 자체 보유 브랜드 자산
- **비고**: 로딩 화면 등에 픽셀화하여 사용

---

## 라이브러리 / 오픈소스 (참고용 — package.json 기준 자동 포함)

- **Electron** — MIT License
- **Three.js** — MIT License
- **uiohook-napi** — MIT License (https://github.com/SnosMe/uiohook-napi)

이 라이브러리들은 npm을 통해 설치되며 각자의 라이선스(대부분 MIT)를 따릅니다. 배포 시 `node_modules` 내 각 패키지의 LICENSE 파일이 함께 포함되는 것이 일반적입니다.

---

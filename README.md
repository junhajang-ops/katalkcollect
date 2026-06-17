# katalkcollect

LDPlayer(Android 에뮬레이터) 위의 **MessengerBotR**에서 동작하는 카카오톡 그룹채팅 **로컬 로깅 봇**입니다.
수신되는 그룹채팅 메시지를 KST 날짜·시간대·방별로 분리해, 보존용 원본(JSONL)과 LLM 분석용 축약(TXT) 두 형식으로 로컬에 저장합니다.

> ⚠️ 이 저장소는 **코드 쇼케이스**입니다.
> 실제 수집된 대화 로그(`kakao_logs/`)와 런타임 로그(`log.json` 등)는 타인의 개인정보를 포함하므로 저장소에 포함하지 않습니다. 코드 실행 시 로컬에 자동 생성됩니다.

## 주요 기능

- 카카오톡(`com.kakao.talk`) **그룹채팅만** 선별 저장 (1:1·타 메신저 제외)
- KST 기준 날짜 + 3개 시간대 세그먼트로 파일 분리
- **이중 출력**: 보존용 원본 JSONL(`raw/`) + LLM용 한 줄 축약 TXT(`llm/`)
- 통합(`all/`)과 방별(`rooms/`) 동시 기록
- 같은 (방·발신자·메시지)가 3초 내 재수신되면 **중복 제거**
- 날짜별 **인덱스** 생성 (본문 제외, 탐색·매핑용)
- `RETENTION_DAYS` 기반 **자동 보관 정리** + 봇 디버그 로그 OOM 방지 truncate

## 아키텍처 / 데이터 흐름

```
MessengerBotR response() 이벤트
  └─ 메시지 수신
      → 필터:  패키지(com.kakao.talk) · 그룹채팅 여부 · 빈 room/msg 제외
      → 중복 제거:  (room|sender|msg) 키, TTL 3초
      → saveMessage()
          ├─ raw  JSONL   UTC 시각 · 전체 메타(logId/channelId/userHash 포함)
          ├─ llm  TXT      KST 시각 · 축약(room/sender/msg만, 한 줄)
          └─ index JSONL   UTC+KST+파일경로 (본문 제외)
      → maybeRunRetentionCleanup()  (24h 주기, 오래된 파일 정리)
```

## 저장 구조

```
/sdcard/Pictures/kakao_logs
  ├─ raw/                         보존용 원본 (손실 없음)
  │   ├─ all/   2026-05-03_1_0000-1059.jsonl
  │   └─ rooms/ 2026-05-03_1_0000-1059/<방이름>.jsonl
  ├─ llm/                         LLM 분석용 축약
  │   ├─ all/   2026-05-03_1_0000-1059.txt
  │   └─ rooms/ 2026-05-03_1_0000-1059/<방이름>.txt
  ├─ index/   2026-05-03.jsonl    날짜별 인덱스
  └─ path_test.txt                경로/쓰기 점검 기록
```

시간대 세그먼트 (KST): `1` = 00:00–10:59, `2` = 11:00–18:59, `3` = 19:00–23:59

## 설계 의도

- **원본 vs LLM 분리** — `raw`는 손실 없는 보존(UTC, 전체 필드), `llm`은 토큰을 아끼는 한 줄 축약(KST, 핵심 필드만). 분석 파이프라인이 원본을 건드리지 않도록 출력을 분리.
- **시간대 세그먼트 분할** — 하루를 3구간으로 나눠 단일 파일이 무한정 커지는 것을 막고 시간대별 접근을 단순화.
- **UTC / KST 이원화** — 기계 판독용 원본은 UTC ISO로 통일, 사람이 읽는 LLM·인덱스는 KST 병기.
- **OOM 방어** — Android Rhino 엔진에서 대용량 JSON `JSON.parse`가 OOM을 유발. 봇 디버그 로그는 5MB 초과 시 파싱 없이 truncate(`compactOrTruncateBotLog`).
- **방이름은 런타임 입력** — 방 식별자를 코드에 하드코딩하지 않고, 이벤트로 받은 값을 파일명으로 정규화(`sanitizeFileName`). 어떤 방에도 그대로 적용 가능.

## 실행 환경

- Android 환경(예: LDPlayer) + [MessengerBotR](https://github.com/MessengerBotTeam)
- `bot.json` — MessengerBotR 봇 설정(스크립트 진입점, API level 등)
- `katalkcollect.js`를 봇 스크립트로 로드하면 컴파일 시 경로 점검 1회 + 메시지 수신마다 `response()`가 동작

## 저장 경로 변경

기본 저장 위치는 `/sdcard/Pictures/kakao_logs`. 파일 상단 상수 `PICTURES_DIR` / `BASE_DIR`에서 변경할 수 있습니다.

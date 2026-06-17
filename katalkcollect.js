// Kakao Group Chat Local Logger for MessengerBotR + LDPlayer
// 기능:
// 1. 카카오톡 그룹채팅만 저장
// 2. KST 기준 날짜/시간대별 파일 분리
// 3. 기록용 원본 JSONL은 raw/ 아래 저장
// 4. LLM용 축약 TXT는 llm/ 아래 저장
// 5. all도 시간대별 분리
// 6. rooms도 시간대 상위 폴더 → 방별 파일 구조
// 7. 원본 JSONL 시간은 UTC만 기록
// 8. LLM용 TXT 시간은 KST만 기록
// 9. 날짜별 index 저장
// 10. path_test.txt 생성
// 11. 중복 제거 포함
//
// 저장 위치:
// /sdcard/Pictures/kakao_logs
//
// 파일 분리 기준, KST:
// 1 = 00:00:00 이상 ~ 11:00:00 미만
// 2 = 11:00:00 이상 ~ 19:00:00 미만
// 3 = 19:00:00 이상 ~ 다음날 00:00:00 미만
//
// 최종 구조:
// /sdcard/Pictures/kakao_logs
//   ├─ raw/
//   │   ├─ all/
//   │   │   ├─ 2026-05-03_1_0000-1059.jsonl
//   │   │   ├─ 2026-05-03_2_1100-1859.jsonl
//   │   │   └─ 2026-05-03_3_1900-2359.jsonl
//   │   └─ rooms/
//   │       ├─ 2026-05-03_1_0000-1059/
//   │       │   └─ 방이름.jsonl
//   │       ├─ 2026-05-03_2_1100-1859/
//   │       │   └─ 방이름.jsonl
//   │       └─ 2026-05-03_3_1900-2359/
//   │           └─ 방이름.jsonl
//   ├─ llm/
//   │   ├─ all/
//   │   │   ├─ 2026-05-03_1_0000-1059.txt
//   │   │   ├─ 2026-05-03_2_1100-1859.txt
//   │   │   └─ 2026-05-03_3_1900-2359.txt
//   │   └─ rooms/
//   │       ├─ 2026-05-03_1_0000-1059/
//   │       │   └─ 방이름.txt
//   │       ├─ 2026-05-03_2_1100-1859/
//   │       │   └─ 방이름.txt
//   │       └─ 2026-05-03_3_1900-2359/
//   │           └─ 방이름.txt
//   ├─ index/
//   │   └─ 2026-05-03.jsonl
//   └─ path_test.txt

const File = java.io.File;
const FileReader = java.io.FileReader;
const FileWriter = java.io.FileWriter;
const BufferedReader = java.io.BufferedReader;
const BufferedWriter = java.io.BufferedWriter;
const StringBuilder = java.lang.StringBuilder;

// ============================================================================
// 저장 경로 설정
// ============================================================================

// LDPlayer에서 PC로 보이는 Pictures 경로
const PICTURES_DIR = "/sdcard/Pictures";
const BASE_DIR = PICTURES_DIR + "/kakao_logs";

// 원본 JSONL 저장 위치
const RAW_DIR = BASE_DIR + "/raw";
const RAW_ALL_DIR = RAW_DIR + "/all";
const RAW_ROOMS_DIR = RAW_DIR + "/rooms";

// LLM용 축약 TXT 저장 위치
const LLM_DIR = BASE_DIR + "/llm";
const LLM_ALL_DIR = LLM_DIR + "/all";
const LLM_ROOMS_DIR = LLM_DIR + "/rooms";

// 인덱스 / 경로 테스트
const INDEX_DIR = BASE_DIR + "/index";
const PATH_TEST_PATH = BASE_DIR + "/path_test.txt";
const GLOBAL_LOG_PATH = PICTURES_DIR + "/GLOBAL_LOG.json";
const BOT_LOG_PATH = PICTURES_DIR + "/Bots/katalkcollect/log.json";
const RETENTION_STATE_PATH = BASE_DIR + "/retention_cleanup_state.json";

// 저장 여부 설정
// 운영 초기에는 둘 다 true 권장
const WRITE_RAW_LOG = true;
const WRITE_LLM_LOG = true;

// ============================================================================
// 보관 기간 / 자동 정리 설정
// ============================================================================

const RETENTION_DAYS = 365;
const RETENTION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BOT_LOG_MAX_BYTES = 5 * 1024 * 1024;
let lastRetentionCleanupAtMs = 0;

// ============================================================================
// 중복 제거 설정
// ============================================================================

// 같은 room + sender + msg가 3초 안에 다시 들어오면 중복으로 판단
const recent = {};
const DEDUP_TTL_MS = 3000;
const CACHE_KEEP_MS = 60000;

// ============================================================================
// 시간 / 문자열 함수
// ============================================================================

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function nowUtcIsoString() {
  return new Date().toISOString();
}

function getKstInfo() {
  // Date.now()는 UTC epoch 기준.
  // 여기에 9시간을 더한 뒤 UTC getter를 사용하면 KST 기준 날짜/시간 계산 가능.
  const kstDate = new Date(Date.now() + 9 * 60 * 60 * 1000);

  const year = kstDate.getUTCFullYear();
  const month = pad2(kstDate.getUTCMonth() + 1);
  const day = pad2(kstDate.getUTCDate());

  const hour = kstDate.getUTCHours();
  const minute = pad2(kstDate.getUTCMinutes());
  const second = pad2(kstDate.getUTCSeconds());

  const dateStr = year + "-" + month + "-" + day;
  const timeStr = pad2(hour) + ":" + minute + ":" + second;

  let segmentNo;
  let segmentRange;

  if (hour < 11) {
    segmentNo = "1";
    segmentRange = "0000-1059";
  } else if (hour < 19) {
    segmentNo = "2";
    segmentRange = "1100-1859";
  } else {
    segmentNo = "3";
    segmentRange = "1900-2359";
  }

  const segmentKey = dateStr + "_" + segmentNo + "_" + segmentRange;

  return {
    dateStr: dateStr,
    timeStr: timeStr,
    dateTimeStr: dateStr + " " + timeStr,
    hour: hour,
    segmentNo: segmentNo,
    segmentRange: segmentRange,
    segmentKey: segmentKey
  };
}

function sanitizeFileName(name) {
  if (name == null || String(name).trim() === "") {
    return "unknown_room";
  }

  return String(name)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "_")
    .substring(0, 100);
}

function normalizeForOneLine(text) {
  if (text == null) {
    return "";
  }

  return String(text)
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\n")
    .replace(/\t/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ============================================================================
// 파일 함수
// ============================================================================

function ensureDir(path) {
  const dir = new File(path);

  if (!dir.exists()) {
    const ok = dir.mkdirs();
    Log.i("[KAKAO_LOGGER] mkdir path=" + path + " ok=" + ok);
  }

  return dir.exists();
}

function appendLine(path, line) {
  const file = new File(path);
  const parent = file.getParentFile();

  if (parent != null && !parent.exists()) {
    const ok = parent.mkdirs();
    Log.i(
      "[KAKAO_LOGGER] parent mkdir" +
      " path=" + parent.getAbsolutePath() +
      " ok=" + ok
    );
  }

  const writer = new BufferedWriter(new FileWriter(file, true));

  try {
    writer.write(line);
    writer.newLine();
  } finally {
    writer.close();
  }

  return file;
}

// ============================================================================
// 중복 제거
// ============================================================================

// File helpers
function readAllText(path) {
  const file = new File(path);

  if (!file.exists() || !file.isFile()) {
    return null;
  }

  const reader = new BufferedReader(new FileReader(file));
  const sb = new StringBuilder();
  let line;
  let first = true;

  try {
    while ((line = reader.readLine()) != null) {
      if (!first) {
        sb.append("\n");
      }

      sb.append(line);
      first = false;
    }
  } finally {
    reader.close();
  }

  return String(sb.toString());
}

function writeAllText(path, text) {
  const file = new File(path);
  const parent = file.getParentFile();

  if (parent != null && !parent.exists()) {
    parent.mkdirs();
  }

  const writer = new BufferedWriter(new FileWriter(file, false));

  try {
    writer.write(text);
  } finally {
    writer.close();
  }

  return file;
}

// ============================================================================
// Retention cleanup
// ============================================================================

function getKstDateStringFromMillis(ms) {
  const kstDate = new Date(ms + 9 * 60 * 60 * 1000);
  const year = kstDate.getUTCFullYear();
  const month = pad2(kstDate.getUTCMonth() + 1);
  const day = pad2(kstDate.getUTCDate());

  return year + "-" + month + "-" + day;
}

function getRetentionCutoffDateString(nowMs) {
  return getKstDateStringFromMillis(
    nowMs - RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
}

function extractDatePrefix(name) {
  const match = String(name).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function extractYmdDate(text) {
  const match = String(text).match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  return match ? match[1] + "-" + match[2] + "-" + match[3] : null;
}

function shouldDeleteByDate(dateStr, cutoffDateStr) {
  return dateStr != null && dateStr < cutoffDateStr;
}

function deleteRecursively(file, stats) {
  if (file == null || !file.exists()) {
    return true;
  }

  if (file.isDirectory()) {
    const children = file.listFiles();

    if (children != null) {
      for (let i = 0; i < children.length; i++) {
        deleteRecursively(children[i], stats);
      }
    }
  }

  const wasDir = file.isDirectory();
  const ok = file.delete();

  if (ok) {
    if (wasDir) {
      stats.deletedDirs++;
    } else {
      stats.deletedFiles++;
    }
  } else if (file.exists()) {
    stats.deleteErrors++;
    Log.e("[KAKAO_LOGGER_RETENTION] delete failed path=" + file.getAbsolutePath());
  }

  return ok;
}

function cleanupDateFiles(dirPath, allowedSuffixes, cutoffDateStr, stats) {
  const dir = new File(dirPath);

  if (!dir.exists() || !dir.isDirectory()) {
    return;
  }

  const files = dir.listFiles();

  if (files == null) {
    return;
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (!file.isFile()) {
      continue;
    }

    const name = file.getName();
    const dateStr = extractDatePrefix(name);

    if (!shouldDeleteByDate(dateStr, cutoffDateStr)) {
      continue;
    }

    let suffixOk = false;

    for (let j = 0; j < allowedSuffixes.length; j++) {
      if (name.substring(name.length - allowedSuffixes[j].length) === allowedSuffixes[j]) {
        suffixOk = true;
        break;
      }
    }

    if (suffixOk) {
      deleteRecursively(file, stats);
    }
  }
}

function cleanupDateDirs(dirPath, cutoffDateStr, stats) {
  const dir = new File(dirPath);

  if (!dir.exists() || !dir.isDirectory()) {
    return;
  }

  const files = dir.listFiles();

  if (files == null) {
    return;
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (!file.isDirectory()) {
      continue;
    }

    const dateStr = extractDatePrefix(file.getName());

    if (shouldDeleteByDate(dateStr, cutoffDateStr)) {
      deleteRecursively(file, stats);
    }
  }
}

function compactPathTestLog(cutoffDateStr, stats) {
  const text = readAllText(PATH_TEST_PATH);

  if (text == null || text === "") {
    return;
  }

  const lines = text.split("\n");
  const kept = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dateStr = extractYmdDate(line);

    if (!shouldDeleteByDate(dateStr, cutoffDateStr)) {
      kept.push(line);
    }
  }

  if (kept.length !== lines.length) {
    writeAllText(PATH_TEST_PATH, kept.join("\n") + (kept.length > 0 ? "\n" : ""));
    stats.compactedFiles++;
  }
}

function compactJsonArrayLogStrict(path, cutoffDateStr, stats) {
  const text = readAllText(path);

  if (text == null || String(text).trim() === "") {
    return true;
  }

  let records;

  try {
    records = JSON.parse(text);
  } catch (e) {
    return false;
  }

  if (records == null || typeof records.length !== "number") {
    return true;
  }

  const kept = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const dateStr = record != null && record.c != null
      ? extractYmdDate(record.c)
      : null;

    if (!shouldDeleteByDate(dateStr, cutoffDateStr)) {
      kept.push(record);
    }
  }

  if (kept.length !== records.length) {
    writeAllText(path, JSON.stringify(kept));
    stats.compactedFiles++;
  }

  return true;
}

function compactJsonArrayLogLoose(path, cutoffDateStr, stats) {
  const text = readAllText(path);

  if (text == null || String(text).trim() === "") {
    return;
  }

  let body = String(text).trim();

  if (body.charAt(0) === "[") {
    body = body.substring(1);
  }

  if (body.charAt(body.length - 1) === "]") {
    body = body.substring(0, body.length - 1);
  }

  if (String(body).trim() === "") {
    return;
  }

  const parts = body.split('},{"a":');
  const kept = [];

  for (let i = 0; i < parts.length; i++) {
    let entry = parts[i];

    if (i > 0) {
      entry = '{"a":' + entry;
    }

    const dateStr = extractYmdDate(entry);

    if (!shouldDeleteByDate(dateStr, cutoffDateStr)) {
      kept.push(entry);
    }
  }

  if (kept.length !== parts.length) {
    writeAllText(path, "[" + kept.join(",") + "]");
    stats.compactedFiles++;
  }
}

function compactJsonArrayLog(path, cutoffDateStr, stats) {
  if (!compactJsonArrayLogStrict(path, cutoffDateStr, stats)) {
    compactJsonArrayLogLoose(path, cutoffDateStr, stats);
  }
}

function compactOrTruncateBotLog(path, cutoffDateStr, stats) {
  const file = new File(path);

  if (!file.exists() || !file.isFile()) {
    return;
  }

  if (file.length() > BOT_LOG_MAX_BYTES) {
    writeAllText(path, "[]");
    stats.compactedFiles++;
    return;
  }

  compactJsonArrayLog(path, cutoffDateStr, stats);
}

function readRetentionCleanupState() {
  const text = readAllText(RETENTION_STATE_PATH);

  if (text == null || String(text).trim() === "") {
    return 0;
  }

  try {
    const state = JSON.parse(text);
    const value = Number(state.lastCleanupAtMs || 0);
    return isNaN(value) ? 0 : value;
  } catch (e) {
    return 0;
  }
}

function writeRetentionCleanupState(nowMs, cutoffDateStr, stats) {
  writeAllText(
    RETENTION_STATE_PATH,
    JSON.stringify({
      lastCleanupAtMs: nowMs,
      lastCleanupAtUtc: new Date(nowMs).toISOString(),
      retentionDays: RETENTION_DAYS,
      cutoffDateKst: cutoffDateStr,
      deletedFiles: stats.deletedFiles,
      deletedDirs: stats.deletedDirs,
      compactedFiles: stats.compactedFiles,
      deleteErrors: stats.deleteErrors
    })
  );
}

function runRetentionCleanup(reason, nowMs) {
  const cutoffDateStr = getRetentionCutoffDateString(nowMs);
  const stats = {
    deletedFiles: 0,
    deletedDirs: 0,
    compactedFiles: 0,
    deleteErrors: 0
  };

  cleanupDateFiles(INDEX_DIR, [".jsonl"], cutoffDateStr, stats);
  cleanupDateFiles(RAW_ALL_DIR, [".jsonl"], cutoffDateStr, stats);
  cleanupDateDirs(RAW_ROOMS_DIR, cutoffDateStr, stats);
  cleanupDateFiles(LLM_ALL_DIR, [".txt"], cutoffDateStr, stats);
  cleanupDateDirs(LLM_ROOMS_DIR, cutoffDateStr, stats);

  compactPathTestLog(cutoffDateStr, stats);
  compactJsonArrayLog(GLOBAL_LOG_PATH, cutoffDateStr, stats);
  compactOrTruncateBotLog(BOT_LOG_PATH, cutoffDateStr, stats);

  writeRetentionCleanupState(nowMs, cutoffDateStr, stats);

  Log.i(
    "[KAKAO_LOGGER_RETENTION] cleanup done" +
    " reason=" + reason +
    " retentionDays=" + RETENTION_DAYS +
    " cutoffDateKst=" + cutoffDateStr +
    " deletedFiles=" + stats.deletedFiles +
    " deletedDirs=" + stats.deletedDirs +
    " compactedFiles=" + stats.compactedFiles +
    " deleteErrors=" + stats.deleteErrors
  );
}

function maybeRunRetentionCleanup(reason) {
  try {
    const nowMs = Date.now();

    if (lastRetentionCleanupAtMs <= 0) {
      lastRetentionCleanupAtMs = readRetentionCleanupState();
    }

    if (lastRetentionCleanupAtMs > nowMs) {
      lastRetentionCleanupAtMs = 0;
    }

    if (
      lastRetentionCleanupAtMs > 0 &&
      nowMs - lastRetentionCleanupAtMs < RETENTION_CLEANUP_INTERVAL_MS
    ) {
      return;
    }

    runRetentionCleanup(reason, nowMs);
    lastRetentionCleanupAtMs = nowMs;
  } catch (e) {
    Log.e("[KAKAO_LOGGER_RETENTION_ERROR] " + e);
  }
}

// Dedup
function makeDedupKey(room, sender, msg) {
  return String(room) + "|" + String(sender) + "|" + String(msg);
}

function isDuplicate(room, sender, msg) {
  const now = Date.now();
  const key = makeDedupKey(room, sender, msg);

  if (recent[key] && now - recent[key] < DEDUP_TTL_MS) {
    return true;
  }

  recent[key] = now;
  return false;
}

function cleanupDedupCache() {
  const now = Date.now();
  const keys = Object.keys(recent);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];

    if (now - recent[key] > CACHE_KEEP_MS) {
      delete recent[key];
    }
  }
}

// ============================================================================
// 경로 구성
// ============================================================================

function buildPaths(room) {
  const kst = getKstInfo();
  const roomFileName = sanitizeFileName(room);

  // 원본 통합 파일:
  // raw/all/2026-05-03_1_0000-1059.jsonl
  const allRawPath =
    RAW_ALL_DIR + "/" + kst.segmentKey + ".jsonl";

  // 원본 방별 파일:
  // raw/rooms/2026-05-03_1_0000-1059/방이름.jsonl
  const roomRawDir =
    RAW_ROOMS_DIR + "/" + kst.segmentKey;

  const roomRawPath =
    roomRawDir + "/" + roomFileName + ".jsonl";

  // LLM용 통합 파일:
  // llm/all/2026-05-03_1_0000-1059.txt
  const allLlmPath =
    LLM_ALL_DIR + "/" + kst.segmentKey + ".txt";

  // LLM용 방별 파일:
  // llm/rooms/2026-05-03_1_0000-1059/방이름.txt
  const roomLlmDir =
    LLM_ROOMS_DIR + "/" + kst.segmentKey;

  const roomLlmPath =
    roomLlmDir + "/" + roomFileName + ".txt";

  // 날짜별 index:
  // index/2026-05-03.jsonl
  const indexPath =
    INDEX_DIR + "/" + kst.dateStr + ".jsonl";

  return {
    kst: kst,
    roomFileName: roomFileName,

    allRawPath: allRawPath,
    roomRawDir: roomRawDir,
    roomRawPath: roomRawPath,

    allLlmPath: allLlmPath,
    roomLlmDir: roomLlmDir,
    roomLlmPath: roomLlmPath,

    indexPath: indexPath
  };
}

// ============================================================================
// 경로 테스트
// ============================================================================

function writePathTest() {
  try {
    ensureDir(BASE_DIR);

    ensureDir(RAW_DIR);
    ensureDir(RAW_ALL_DIR);
    ensureDir(RAW_ROOMS_DIR);

    ensureDir(LLM_DIR);
    ensureDir(LLM_ALL_DIR);
    ensureDir(LLM_ROOMS_DIR);

    ensureDir(INDEX_DIR);

    const kst = getKstInfo();

    const testFile = appendLine(
      PATH_TEST_PATH,
      nowUtcIsoString() +
      " | path test" +
      " | kst=" + kst.dateTimeStr +
      " | BASE_DIR=" + BASE_DIR
    );

    Log.i(
      "[KAKAO_LOGGER] path test" +
      " basePath=" + BASE_DIR +
      " testPath=" + PATH_TEST_PATH +
      " exists=" + testFile.exists() +
      " size=" + testFile.length()
    );

  } catch (e) {
    Log.e("[KAKAO_LOGGER_PATH_TEST_ERROR] " + e);
  }
}

// ============================================================================
// 저장 함수
// ============================================================================

function saveMessage(
  room,
  sender,
  msg,
  isGroupChat,
  packageName,
  isMention,
  logId,
  channelId,
  userHash
) {
  const paths = buildPaths(room);
  const kst = paths.kst;

  ensureDir(BASE_DIR);

  ensureDir(RAW_DIR);
  ensureDir(RAW_ALL_DIR);
  ensureDir(RAW_ROOMS_DIR);

  ensureDir(LLM_DIR);
  ensureDir(LLM_ALL_DIR);
  ensureDir(LLM_ROOMS_DIR);

  ensureDir(INDEX_DIR);
  ensureDir(paths.roomRawDir);
  ensureDir(paths.roomLlmDir);

  const receivedAtUtc = nowUtcIsoString();

  // --------------------------------------------------------------------------
  // 기록용 원본 JSONL
  // 시간은 UTC만 기록.
  // KST 필드는 넣지 않음.
  // --------------------------------------------------------------------------

  const rawRecord = {
    receivedAtUtc: receivedAtUtc,
    packageName: packageName,
    room: room,
    sender: sender,
    message: msg,
    isGroupChat: isGroupChat,
    isMention: isMention,
    logId: logId,
    channelId: channelId,
    userHash: userHash
  };

  const rawLine = JSON.stringify(rawRecord);

  // --------------------------------------------------------------------------
  // LLM용 축약 TXT
  // 시간은 KST만 기록.
  // 분석에 불필요한 packageName, userHash, channelId, logId 제거.
  // 한 메시지 = 한 줄 구조 유지.
  // --------------------------------------------------------------------------

  const llmLine =
    "[" + kst.dateTimeStr + " KST]" +
    " room=" + normalizeForOneLine(room) +
    " | sender=" + normalizeForOneLine(sender) +
    " | msg=" + normalizeForOneLine(msg);

  let allRawFile = null;
  let roomRawFile = null;
  let allLlmFile = null;
  let roomLlmFile = null;

  if (WRITE_RAW_LOG) {
    allRawFile = appendLine(paths.allRawPath, rawLine);
    roomRawFile = appendLine(paths.roomRawPath, rawLine);
  }

  if (WRITE_LLM_LOG) {
    allLlmFile = appendLine(paths.allLlmPath, llmLine);
    roomLlmFile = appendLine(paths.roomLlmPath, llmLine);
  }

  // --------------------------------------------------------------------------
  // index
  // 탐색용이므로 UTC + KST + 파일 경로를 같이 남김.
  // 메시지 본문은 넣지 않아 파일 크기를 작게 유지.
  // --------------------------------------------------------------------------

  const indexRecord = {
    receivedAtUtc: receivedAtUtc,
    receivedAtKst: kst.dateTimeStr,
    kstDate: kst.dateStr,
    segmentKey: kst.segmentKey,
    room: room,
    sender: sender,
    rawRoomPath: paths.roomRawPath,
    llmRoomPath: paths.roomLlmPath,
    rawAllPath: paths.allRawPath,
    llmAllPath: paths.allLlmPath
  };

  const indexFile = appendLine(paths.indexPath, JSON.stringify(indexRecord));

  Log.i(
    "[KAKAO_LOGGER] file check" +
    " basePath=" + BASE_DIR +
    " segment=" + kst.segmentKey +

    " allRawPath=" + paths.allRawPath +
    " allRawExists=" + (allRawFile != null ? allRawFile.exists() : false) +
    " allRawSize=" + (allRawFile != null ? allRawFile.length() : 0) +

    " roomRawPath=" + paths.roomRawPath +
    " roomRawExists=" + (roomRawFile != null ? roomRawFile.exists() : false) +
    " roomRawSize=" + (roomRawFile != null ? roomRawFile.length() : 0) +

    " allLlmPath=" + paths.allLlmPath +
    " allLlmExists=" + (allLlmFile != null ? allLlmFile.exists() : false) +
    " allLlmSize=" + (allLlmFile != null ? allLlmFile.length() : 0) +

    " roomLlmPath=" + paths.roomLlmPath +
    " roomLlmExists=" + (roomLlmFile != null ? roomLlmFile.exists() : false) +
    " roomLlmSize=" + (roomLlmFile != null ? roomLlmFile.length() : 0) +

    " indexPath=" + paths.indexPath +
    " indexExists=" + indexFile.exists() +
    " indexSize=" + indexFile.length()
  );
}

// ============================================================================
// 메신저봇R response 이벤트
// ============================================================================

function response(
  room,
  msg,
  sender,
  isGroupChat,
  replier,
  imageDB,
  packageName,
  isMention,
  logId,
  channelId,
  userHash
) {
  try {
    Log.i(
      "[KAKAO_LOGGER] response entered" +
      " packageName=" + packageName +
      " room=" + room +
      " sender=" + sender +
      " isGroupChat=" + isGroupChat +
      " msg=" + msg
    );

    // 카카오톡만 저장
    if (packageName !== "com.kakao.talk") {
      Log.i(
        "[KAKAO_LOGGER] non-kakao skipped" +
        " packageName=" + packageName +
        " room=" + room +
        " sender=" + sender
      );
      return;
    }

    // 그룹채팅만 저장
    if (isGroupChat !== true) {
      Log.i(
        "[KAKAO_LOGGER] private chat skipped" +
        " room=" + room +
        " sender=" + sender +
        " isGroupChat=" + isGroupChat
      );
      return;
    }

    // 필수값 확인
    if (room == null || String(room).trim() === "") {
      Log.i("[KAKAO_LOGGER] empty room skipped");
      return;
    }

    if (msg == null || String(msg).trim() === "") {
      Log.i(
        "[KAKAO_LOGGER] empty msg skipped" +
        " room=" + room +
        " sender=" + sender
      );
      return;
    }

    // 중복 제거
    if (isDuplicate(room, sender, msg)) {
      Log.i(
        "[KAKAO_LOGGER] duplicate skipped" +
        " room=" + room +
        " sender=" + sender +
        " msg=" + msg
      );
      return;
    }

    cleanupDedupCache();

    saveMessage(
      room,
      sender,
      msg,
      isGroupChat,
      packageName,
      isMention,
      logId,
      channelId,
      userHash
    );

    const kst = getKstInfo();

    Log.i(
      "[KAKAO_LOGGER] saved group chat" +
      " basePath=" + BASE_DIR +
      " segment=" + kst.segmentKey +
      " room=" + room +
      " sender=" + sender +
      " msg=" + msg
    );

    maybeRunRetentionCleanup("response");

  } catch (e) {
    Log.e("[KAKAO_LOGGER_ERROR] " + e);
  }
}

// ============================================================================
// 스크립트 로드/컴파일 시 경로 테스트 1회 실행
// ============================================================================

writePathTest();
maybeRunRetentionCleanup("startup");

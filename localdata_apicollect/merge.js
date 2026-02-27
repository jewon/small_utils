'use strict';

const fs    = require('fs');
const path  = require('path');
const iconv = require('iconv-lite');

// ── 공통 컬럼 정의 (merged.csv) ───────────────────────
const COMMON_COLUMNS = [
  'API_NM',           // (추가) 업종명
  'MNG_NO',           // 관리번호
  'OPN_ATMY_GRP_CD',  // 개방자치단체코드
  'BPLC_NM',          // 사업장명
  'BZSTAT_SE_NM',     // 업태구분명
  'SALS_STTS_CD',     // 영업상태코드
  'SALS_STTS_NM',     // 영업상태명
  'DTL_SALS_STTS_CD', // 상세영업상태코드
  'DTL_SALS_STTS_NM', // 상세영업상태명
  'LCPMT_YMD',        // 인허가일자
  'CLSBIZ_YMD',       // 폐업일자
  'ROAD_NM_ADDR',     // 도로명주소
  'LOTNO_ADDR',       // 지번주소
  'ROAD_NM_ZIP',      // 도로명우편번호
  'LCTN_ZIP',         // 소재지우편번호
  'LCTN_AREA',        // 소재지면적
  'TELNO',            // 전화번호
  'CRD_INFO_X',       // 좌표(X)
  'CRD_INFO_Y',       // 좌표(Y)
  'DAT_UPDT_SE',      // 데이터갱신구분
  'DAT_UPDT_PNT',     // 데이터갱신시점
  'LAST_MDFCN_PNT',   // 최종수정시점
];

// ── 유틸 ──────────────────────────────────────────────
function csvEscape(val) {
  const str = val == null ? '' : String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// "행정안전부_식품_축산판매업 조회서비스" → "축산판매업"
function getServiceName(apiName) {
  return apiName.replace(/ 조회서비스$/, '').split('_').pop() ?? '';
}

// EUC-KR 변환 안전 + 파이프 구분자 충돌 방지
// - 개행·파이프는 먼저 공백으로 치환
// - 나머지 각 문자를 EUC-KR로 인코딩 시도:
//     ① 인코딩 불가(→ 0x3F '?') 이면 제거
//     ② 인코딩 결과 바이트에 0x7C('|')가 포함되면 제거 (파이프 오염 방지)
function sanitize(val) {
  if (val == null) return '';
  const str = String(val)
    .replace(/\r\n|\r|\n/g, ' ')  // 개행 → 공백
    .replace(/\u00A0/g, ' ')       // NBSP → 공백
    .replace(/\|/g, ' ');          // 파이프 → 공백 (구분자 보호)

  return [...str].map(ch => {
    const buf = iconv.encode(ch, 'euc-kr');
    // 인코딩 불가: iconv가 '?'(0x3F) 한 바이트로 대체한 경우
    if (buf.length === 1 && buf[0] === 0x3F && ch !== '?') return '';
    // 인코딩 결과에 0x7C(|) 바이트가 포함된 경우
    if (buf.includes(0x7C)) return '';
    return ch;
  }).join('');
}

// EUC-KR 파일 저장
function writeEucKr(filePath, content) {
  fs.writeFileSync(filePath, iconv.encode(content, 'euc-kr'));
}

// ── result_all 생성 ───────────────────────────────────
// 컬럼: 번호|인허가번호|서비스ID|데이터갱신일자|서비스ID명|사업장명|지번주소|도로명주소|인허가일자|좌표정보(X)|좌표정보(Y)|최종수정일자|업태구분명|전화번호
function buildResultAll(datasets) {
  const lines = [
    '번호|인허가번호|서비스ID|데이터갱신일자|서비스ID명|사업장명|지번주소|도로명주소|인허가일자|좌표정보(X)|좌표정보(Y)|최종수정일자|업태구분명|전화번호',
  ];
  let rowNum = 0;
  for (const { apiName, svcId, items } of datasets) {
    const svcNm = getServiceName(apiName);
    for (const item of items) {
      rowNum++;
      lines.push([
        rowNum,
        item.MNG_NO         ?? '',
        svcId               ?? '',   // 서비스ID (api_list.csv에 SVC_ID 컬럼 있으면 사용)
        item.DAT_UPDT_PNT   ?? '',
        sanitize(svcNm),
        sanitize(item.BPLC_NM),
        sanitize(item.LOTNO_ADDR),
        sanitize(item.ROAD_NM_ADDR),
        item.LCPMT_YMD      ?? '',
        item.CRD_INFO_X     ?? '',
        item.CRD_INFO_Y     ?? '',
        item.LAST_MDFCN_PNT ?? '',
        sanitize(item.BZSTAT_SE_NM),
        item.TELNO          ?? '',
      ].join('|'));
    }
  }
  return lines.join('\n');
}

// ── result_coordmapping 생성 ──────────────────────────
// 컬럼: 사업장명 | (빈칸) | 도로명주소  — 헤더 없음
function buildCoordMapping(datasets) {
  const lines = [];
  for (const { items } of datasets) {
    for (const item of items) {
      lines.push([
        sanitize(item.BPLC_NM),
        '',
        sanitize(item.ROAD_NM_ADDR),
      ].join('|'));
    }
  }
  return lines.join('\n');
}

// ── 메인 ─────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const keepJson = args.includes('--keep');
  const [rangeDir] = args.filter(a => !a.startsWith('--'));
  if (!rangeDir) {
    console.error('사용법: node merge.js <날짜범위폴더명> [--keep]');
    console.error('  예시: node merge.js 20250101_20250201');
    console.error('  --keep : 병합 후 JSON 파일 유지 (기본값: 삭제)');
    process.exit(1);
  }

  const inputDir = path.join(__dirname, 'output', rangeDir);
  if (!fs.existsSync(inputDir)) {
    console.error(`폴더 없음: ${inputDir}`);
    process.exit(1);
  }

  const jsonFiles = fs.readdirSync(inputDir)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));

  if (jsonFiles.length === 0) {
    console.error('병합할 JSON 파일이 없습니다. collect.js 를 먼저 실행하세요.');
    process.exit(1);
  }

  console.log(`JSON 파일 ${jsonFiles.length}개 병합 중...`);

  // JSON 전체 로드
  const datasets = jsonFiles.map(file => {
    const json = JSON.parse(fs.readFileSync(path.join(inputDir, file), 'utf-8'));
    return {
      apiName: json.apiName ?? '',
      svcId:   json.svcId   ?? '',   // api_list.csv에 SVC_ID 컬럼 추가 시 collect.js가 저장
      items:   json.items   ?? [],
    };
  });

  // ① merged.csv (UTF-8 BOM, Excel용)
  const mergedPath = path.join(inputDir, 'merged.csv');
  const ws = fs.createWriteStream(mergedPath, { encoding: 'utf8' });
  ws.write('\uFEFF');
  ws.write(COMMON_COLUMNS.join(',') + '\n');
  let totalRows = 0, emptyApis = 0;
  for (const { apiName, svcId, items } of datasets) {
    if (items.length === 0) { emptyApis++; continue; }
    for (const item of items) {
      const row = COMMON_COLUMNS.map(col =>
        col === 'API_NM' ? csvEscape(apiName) : csvEscape(item[col])
      );
      ws.write(row.join(',') + '\n');
      totalRows++;
    }
  }
  ws.end();

  // ② result_all_{from}_{to}.txt (EUC-KR, pipe 구분)
  const resultAllPath = path.join(inputDir, `result_all_${rangeDir}.txt`);
  writeEucKr(resultAllPath, buildResultAll(datasets));

  // ③ result_coordmapping_{from}_{to}.txt (EUC-KR, pipe 구분)
  const coordMapPath = path.join(inputDir, `result_coordmapping_${rangeDir}.txt`);
  writeEucKr(coordMapPath, buildCoordMapping(datasets));

  // JSON 삭제 (--keep 옵션 없을 때)
  if (!keepJson) {
    for (const file of jsonFiles) {
      fs.unlinkSync(path.join(inputDir, file));
    }
    console.log(`JSON ${jsonFiles.length}개 삭제 완료`);
  }

  console.log(`완료: 총 ${totalRows}건`);
  console.log(`결과 없는 업종: ${emptyApis}개`);
  console.log(`저장:`);
  console.log(`  ${mergedPath}`);
  console.log(`  ${resultAllPath}`);
  console.log(`  ${coordMapPath}`);
}

main();

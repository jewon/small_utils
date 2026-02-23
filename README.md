# Small Utils

이 레포지토리는 개발 과정에서 반복적으로 수행되는 작은 작업들을 자동화하기 위한 유틸리티 모음입니다.

## 유틸리티 목록

### 1. Automate API (`automate_api`)
공공데이터포털 등에서 API 활용 신청을 자동으로 수행하는 도구입니다.

- **주요 기능**:
  - `api_urls.txt` 파일에 적힌 URL 목록을 읽어 순차적으로 신청 페이지 접속
  - Puppeteer를 사용한 브라우저 자동화
  - 이미 신청된 내역은 건너뛰고 새로운 신청만 처리 (스크립트 로직에 따라 다름)

- **사용 방법**:
  1. `automate_api/api_urls.txt` 파일에 신청할 API 상세 페이지 URL들을 한 줄에 하나씩 입력합니다.
  2. 해당 디렉토리에서 스크립트를 실행합니다:
     ```bash
     node automate_api.js
     ```

---

## 설치 및 요구사항
- **Node.js**: v14 이상 권장
- **Dependencies**: `npm install puppeteer`

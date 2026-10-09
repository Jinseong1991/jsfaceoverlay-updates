# JSFaceOverlay-avatar-dev 백업 + GitHub 업로드 스크립트
# 사용법: PowerShell에서
#   powershell -ExecutionPolicy Bypass -File .\upload-avatar-dev.ps1

$ErrorActionPreference = 'Continue'   # git의 stderr 출력을 오류로 취급하지 않도록

$Src      = 'C:\Users\LeeJinSeong\Documents\JSFaceOverlay-avatar-dev'
$Owner    = 'Jinseong1991'
$RepoName = 'JSFaceOverlay-avatar-dev'
$RemoteUrl = "https://github.com/$Owner/$RepoName.git"
$MaxMB    = 95   # GitHub 단일 파일 한도(100MB)보다 약간 작게

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

if (-not (Test-Path $Src)) { throw "폴더를 찾을 수 없습니다: $Src" }

# ---------------------------------------------------------------- 1. 백업
Step '1/5 폴더 백업'
$Stamp  = Get-Date -Format 'yyyyMMdd_HHmmss'
$Backup = Join-Path (Split-Path $Src -Parent) "JSFaceOverlay-avatar-dev_backup_$Stamp"
robocopy $Src $Backup /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "백업 실패 (robocopy 코드 $LASTEXITCODE). 업로드를 중단합니다." }
Write-Host "백업 완료: $Backup" -ForegroundColor Green

# ---------------------------------------------------------------- 2. Git 확인
Step '2/5 Git 설치 확인'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host 'Git이 없습니다. 설치 후 PowerShell을 새로 열고 다시 실행하세요:' -ForegroundColor Yellow
    Write-Host '  winget install --id Git.Git -e'
    exit 1
}
git --version

Set-Location $Src

# ---------------------------------------------------------------- 3. .gitignore / 대용량 파일
Step '3/5 업로드 준비 (.gitignore, 대용량 파일 제외)'
$ignore = @(
    '# --- 자동 생성 (upload-avatar-dev.ps1) ---'
    '.env', '.env.*', '*.pem', '*.key'
    'node_modules/', 'dist/', 'build/', 'out/'
    'bin/', 'obj/', '.vs/', '.vscode/', '.idea/', '*.user', '*.suo'
    '__pycache__/', '*.pyc', '.venv/', 'venv/'
    'Thumbs.db', 'desktop.ini', '.DS_Store'
)
# Unity 프로젝트면 Unity 전용 폴더도 제외
if ((Test-Path 'Assets') -and (Test-Path 'ProjectSettings')) {
    $ignore += '/[Ll]ibrary/', '/[Tt]emp/', '/[Oo]bj/', '/[Bb]uild/', '/[Bb]uilds/', '/[Ll]ogs/', '/[Uu]ser[Ss]ettings/', '*.csproj', '*.sln'
    Write-Host 'Unity 프로젝트로 감지됨 - Library/Temp 등 제외'
}
if (Test-Path '.gitignore') {
    $existing = Get-Content '.gitignore'
    $ignore = $ignore | Where-Object { $existing -notcontains $_ }
}
if ($ignore.Count -gt 0) { Add-Content -Path '.gitignore' -Value $ignore -Encoding UTF8 }

$big = Get-ChildItem -Recurse -File -Force |
    Where-Object { $_.FullName -notmatch '\\\.git\\' -and $_.Length -gt $MaxMB * 1MB }
if ($big) {
    Write-Host "${MaxMB}MB 초과 파일은 GitHub에 올릴 수 없어 제외합니다 (백업에는 남아 있음):" -ForegroundColor Yellow
    Add-Content -Path '.gitignore' -Value '# --- 대용량 파일 (GitHub 100MB 한도) ---' -Encoding UTF8
    foreach ($f in $big) {
        $rel = $f.FullName.Substring($Src.Length + 1).Replace('\', '/')
        Write-Host ("  {0}  ({1:N0} MB)" -f $rel, ($f.Length / 1MB))
        Add-Content -Path '.gitignore' -Value "/$rel" -Encoding UTF8
    }
}

# ---------------------------------------------------------------- 4. 커밋
Step '4/5 Git 커밋'
if (-not (Test-Path '.git')) { git init | Out-Null }
if (-not (git config user.name))  { git config user.name  $Owner }
if (-not (git config user.email)) { git config user.email 'ehddlfma1@gmail.com' }
git add -A
if (git status --porcelain) {
    git commit -m "Initial upload of JSFaceOverlay-avatar-dev" | Out-Null
} else {
    Write-Host '새로 커밋할 변경 사항 없음'
}
git branch -M main
Write-Host '커밋에 포함될 파일 수:' (git ls-files | Measure-Object).Count

# ---------------------------------------------------------------- 5. GitHub 저장소 + push
Step '5/5 GitHub 업로드'
git ls-remote $RemoteUrl 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        gh repo create "$Owner/$RepoName" --private
    } else {
        Write-Host 'GitHub에 저장소를 만들어야 합니다. 브라우저가 열리면:' -ForegroundColor Yellow
        Write-Host '  - 이름이 JSFaceOverlay-avatar-dev 인지 확인'
        Write-Host '  - Private 선택, README/.gitignore/license 추가는 하지 말 것'
        Write-Host '  - [Create repository] 클릭'
        Start-Process "https://github.com/new?name=$RepoName&visibility=private"
        Read-Host '저장소를 만든 뒤 Enter를 누르세요'
    }
}

if (git remote | Select-String -Quiet '^origin$') { git remote set-url origin $RemoteUrl }
else { git remote add origin $RemoteUrl }

# 처음 push 시 GitHub 로그인 창이 뜨면 로그인하세요.
git push -u origin main
if ($LASTEXITCODE -ne 0) { throw 'push 실패. 위 오류 메시지를 확인하세요.' }

Write-Host "`n완료! https://github.com/$Owner/$RepoName" -ForegroundColor Green
Write-Host "백업 위치: $Backup"

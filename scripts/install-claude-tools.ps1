<#
  install-claude-tools.ps1
  Installs 5 projects for Claude Code on Windows, outside the C: drive.

    1. Claude-Mem              (thedotmack/claude-mem)
    2. FreeLLMAPI              (tashfeenahmed/freellmapi)
    3. Claude Code Setup       (anthropics/claude-plugins-official)
    4. Elephant Goldfish Model (google/elephant-goldfish-model)
    5. 21st Dev MCP            (21st-dev/magic-mcp)

  HOW TO RUN (in PowerShell):
    powershell -ExecutionPolicy Bypass -File .\install-claude-tools.ps1

  OPTIONS:
    -Drive F              use another main drive instead of D
    -FreeLLMDrive D       put FreeLLMAPI on another drive instead of E
                          (if that drive does not exist, the main drive is used)
    -KeepClaudeConfig     leave the Claude Code config folder on C:
                          (no new login needed, but plugins stay on C:)
    -SkipFreeLLMAPI       do not install FreeLLMAPI

  Safe to run again: existing folders and .env files are not overwritten.
#>

param(
    [string]$Drive = "D",
    [string]$FreeLLMDrive = "E",
    [switch]$KeepClaudeConfig,
    [switch]$SkipFreeLLMAPI
)

$Root = "$($Drive.TrimEnd(':')):\ClaudeTools"
$Results = [ordered]@{}

function Step($text) {
    Write-Host ""
    Write-Host "==== $text ====" -ForegroundColor Cyan
}

function Mark($name, $ok, $note) {
    if ($ok) { $Results[$name] = "OK      $note" } else { $Results[$name] = "FAILED  $note" }
}

# ---------------------------------------------------------------- Step 0
Step "Step 0: Checking prerequisites"

if (-not (Test-Path "$($Drive.TrimEnd(':')):\")) {
    Write-Host "Drive $Drive does not exist. Run again with -Drive <letter>." -ForegroundColor Red
    exit 1
}

$missing = @()
foreach ($tool in "node", "npm", "git", "claude") {
    if (Get-Command $tool -ErrorAction SilentlyContinue) {
        Write-Host "  found   $tool"
    } else {
        Write-Host "  MISSING $tool" -ForegroundColor Red
        $missing += $tool
    }
}
if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "Install these first, then run the script again: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "Node.js needs version 22.12 or later (or 20.19+)."
    exit 1
}
Write-Host "  node version: $(node -v)"

# ---------------------------------------------------------------- Step 1
Step "Step 1: Moving storage locations to $Root"

New-Item -ItemType Directory -Force -Path $Root, "$Root\claude-mem-data", "$Root\npm-cache" | Out-Null

# Claude-Mem database and settings
setx CLAUDE_MEM_DATA_DIR "$Root\claude-mem-data" | Out-Null
$env:CLAUDE_MEM_DATA_DIR = "$Root\claude-mem-data"

# npm download cache
npm config set cache "$Root\npm-cache"

# Claude Code config and plugins
if ($KeepClaudeConfig) {
    Write-Host "  Claude Code config stays on C: (as requested)."
} else {
    New-Item -ItemType Directory -Force -Path "$Root\claude-config" | Out-Null
    setx CLAUDE_CONFIG_DIR "$Root\claude-config" | Out-Null
    $env:CLAUDE_CONFIG_DIR = "$Root\claude-config"
    Write-Host "  Claude Code config moved to $Root\claude-config"
    Write-Host "  NOTE: Claude Code will ask you to log in again the next time you start it." -ForegroundColor Yellow
}
Mark "Storage on $Drive`:" $true $Root

# ---------------------------------------------------------------- Step 2
Step "Step 2: Claude Code Setup plugin"

claude plugin install claude-code-setup@claude-plugins-official
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Adding the official marketplace and trying again..."
    claude plugin marketplace add anthropics/claude-plugins-official
    claude plugin install claude-code-setup@claude-plugins-official
}
Mark "Claude Code Setup" ($LASTEXITCODE -eq 0) ""

# ---------------------------------------------------------------- Step 3
Step "Step 3: Elephant Goldfish Model plugin"

claude plugin marketplace add google/elephant-goldfish-model
claude plugin install egm@egm
Mark "Elephant Goldfish Model" ($LASTEXITCODE -eq 0) ""

# ---------------------------------------------------------------- Step 4
Step "Step 4: 21st Dev MCP plugin"

Write-Host "  Get a free API key at https://21st.dev/mcp"
$key21 = Read-Host "  Paste your 21st API key (or press Enter to skip for now)"
if ($key21) {
    setx API_KEY_21ST "$key21" | Out-Null
    $env:API_KEY_21ST = $key21
}
claude plugin marketplace add 21st-dev/magic-mcp
claude plugin install 21st@21st-dev
if ($key21) {
    Mark "21st Dev MCP" ($LASTEXITCODE -eq 0) ""
} else {
    Mark "21st Dev MCP" ($LASTEXITCODE -eq 0) "(no key yet: run  setx API_KEY_21ST ""your-key""  later)"
}

# ---------------------------------------------------------------- Step 5
if ($SkipFreeLLMAPI) {
    $Results["FreeLLMAPI"] = "SKIPPED"
} else {
    Step "Step 5: FreeLLMAPI"

    $flDrive = $FreeLLMDrive.TrimEnd(':')
    if (Test-Path "${flDrive}:\") {
        $flRoot = "${flDrive}:\ClaudeTools"
    } else {
        Write-Host "  Drive $flDrive not found - using $Root instead." -ForegroundColor Yellow
        $flRoot = $Root
    }
    New-Item -ItemType Directory -Force -Path $flRoot | Out-Null
    $fl = "$flRoot\freellmapi"
    if (Test-Path $fl) {
        Write-Host "  $fl already exists - keeping it."
    } else {
        git clone https://github.com/tashfeenahmed/freellmapi.git $fl
    }

    if (Test-Path "$fl\package.json") {
        Push-Location $fl
        npm install
        $flOk = ($LASTEXITCODE -eq 0)
        if (Test-Path ".env") {
            Write-Host "  .env already exists - keeping your encryption key."
        } else {
            $ENCRYPTION_KEY = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
            "ENCRYPTION_KEY=$ENCRYPTION_KEY`nPORT=3001" | Out-File -Encoding utf8 .env
        }
        Pop-Location
        Mark "FreeLLMAPI" $flOk $fl
    } else {
        Mark "FreeLLMAPI" $false "clone failed"
    }
}

# ---------------------------------------------------------------- Step 6
Step "Step 6: Claude-Mem"

Write-Host "  A setup page will open in your browser." -ForegroundColor Yellow
Write-Host "  Choose your memory provider and telemetry there."
Write-Host "  'Anthropic plan' needs no account or card. The 'observer' trial asks for a card."
npx -y claude-mem install --setup browser
npx -y claude-mem doctor
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Doctor reported a problem - running repair..."
    npx -y claude-mem repair
    npx -y claude-mem doctor
}
Mark "Claude-Mem" ($LASTEXITCODE -eq 0) "data in $Root\claude-mem-data"

# ---------------------------------------------------------------- Step 7
Step "Step 7: Verification"

claude plugin list

Write-Host ""
Write-Host "==================== SUMMARY ====================" -ForegroundColor Green
foreach ($k in $Results.Keys) {
    "{0,-26} {1}" -f $k, $Results[$k]
}
Write-Host "=================================================" -ForegroundColor Green

Write-Host ""
Write-Host "NEXT STEPS"
Write-Host "  1. Close this window and open a NEW PowerShell window."
Write-Host "  2. Start Claude Code in a project folder:   claude"
Write-Host "  3. Try:"
Write-Host "       recommend automations for this project"
Write-Host "       /egm:egm-review <path to a document>"
Write-Host "       search 21st for a dashboard card component"
if (-not $SkipFreeLLMAPI) {
    Write-Host ""
    Write-Host "  FreeLLMAPI: start it whenever you need it with"
    Write-Host "       cd $fl"
    Write-Host "       npm run dev"
    Write-Host "     then open http://localhost:5173 , create the account and add your provider keys."

    $start = Read-Host "Start FreeLLMAPI now in a new window? (y/n)"
    if ($start -eq "y") {
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$fl'; npm run dev"
        Start-Sleep -Seconds 15
        Start-Process "http://localhost:5173"
    }
}

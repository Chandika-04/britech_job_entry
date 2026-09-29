# Warehouse PC setup

How to install and run Britech Job Entry on the warehouse PC (`Shipping-Bri`).
One process on port 8000 serves both the website and the API. Phones and other PCs
on the network open `http://Shipping-Bri:8000` (or the PC's IP address).

Already on the PC: Windows 11 Home, Python 3.14, Git, ODBC Driver 17 for SQL Server,
SQL Server 2022 Express (`Shipping-Bri\SQLEXPRESS`).

Folder layout used below:

| Path | Contents |
|---|---|
| `C:\BritechJobEntry\app` | The code (git clone) |
| `C:\BritechJobEntry\pdfs` | Uploaded PO PDFs |
| `C:\BritechJobEntry\logs` | Server logs, one file per month |

Run the commands in **PowerShell**. Steps marked *(admin)* need "Run as administrator".

---

## 1. Allow PowerShell scripts (once)

Windows Home blocks `.ps1` scripts by default, and `npm` is one.

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Answer `Y`.

## 2. Install Node.js LTS (once)

```powershell
winget install OpenJS.NodeJS.LTS
```

Close and reopen PowerShell, then check: `node --version` and `npm --version` both print a version.

## 3. Get the code

```powershell
New-Item -ItemType Directory -Force C:\BritechJobEntry | Out-Null
cd C:\BritechJobEntry
git clone https://github.com/Chandika-04/britech_job_entry.git app
cd app
```

Git opens a browser window to sign in to GitHub the first time.

## 4. Install the Python packages

```powershell
cd C:\BritechJobEntry\app\backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

If a package fails to install on Python 3.14 (errors mentioning "building wheel" or
"Microsoft Visual C++"):

- If it is `psycopg` (the PostgreSQL driver, not used here), remove the `psycopg[binary]`
  line from `requirements.txt` and run the install again.
- Otherwise install Python 3.13 (`winget install Python.Python.3.13`), delete the `.venv`
  folder, and redo this step with `py -3.13 -m venv .venv`.

## 5. Build the website

```powershell
cd C:\BritechJobEntry\app\frontend
npm ci
npm run build
```

This creates `frontend\dist`, which the server serves.

## 6. Create the database *(in SSMS)*

Connect to `Shipping-Bri\SQLEXPRESS`, open **New Query**, and run:

```sql
CREATE DATABASE BritechJobEntry;
```

The app creates its own tables on first start. Do not put these tables in the ShopKeeper database.

The steps below use **Windows authentication**: the app connects as the Windows user
that runs it, so no database password goes in the config file. That user must be able to
log in to SQL Server (the account that installed SQL Server Express already can).

## 7. Create the config file

Create `C:\BritechJobEntry\app\.env` (copy `.env.example` and edit it). The settings
that matter on this PC:

```text
DATABASE_URL=mssql+pyodbc://@localhost%5CSQLEXPRESS/BritechJobEntry?driver=ODBC+Driver+17+for+SQL+Server&Trusted_Connection=yes

PDF_STORAGE_DIR=C:\BritechJobEntry\pdfs
PDF_BACKUP_DIR=\\DISKSTATION\SHARE\BritechJobEntry\pdfs

ANTHROPIC_API_KEY=<the Anthropic key>
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
EXTRACTION_PROVIDER=claude

SHOPKEEPER_PROVIDER=shopkeeper
SHOPKEEPER_CONNECTION_STRING=<same value as on the development PC>
SHOPKEEPER_EXPECTED_DATABASE=SkData_Test

CORS_ORIGINS=
```

Notes:

- `%5C` is the `\` in `localhost\SQLEXPRESS`. Keep it written that way.
- `PDF_BACKUP_DIR` is a placeholder. Replace it with the real DiskStation path (copy it
  from File Explorer's address bar), or leave it blank to skip the backup copy for now.
- In `SHOPKEEPER_CONNECTION_STRING`, the driver must be one installed on this PC:
  `DRIVER={ODBC Driver 17 for SQL Server}`.
- `SHOPKEEPER_EXPECTED_DATABASE=SkData_Test` keeps job creation pointed at the ShopKeeper
  **test** database. Change it (and the connection string) only when you are ready to
  create real jobs.
- This file holds secrets. It is ignored by git; never commit or share it.

## 8. First start (by hand)

```powershell
powershell -ExecutionPolicy Bypass -File C:\BritechJobEntry\app\scripts\run_server.ps1
```

The first start creates the tables in `BritechJobEntry`. In another PowerShell window, check it:

```powershell
Invoke-WebRequest http://localhost:8000/api/health -UseBasicParsing | Select-Object StatusCode
```

`200` means it's running. Open `http://localhost:8000` in a browser and upload a test PO.
If it doesn't start, read the newest file in `C:\BritechJobEntry\logs`.

Stop it with `Ctrl+C`, or from another window:

```powershell
powershell -ExecutionPolicy Bypass -File C:\BritechJobEntry\app\scripts\stop_server.ps1
```

## 9. Let phones and other PCs connect *(admin)*

Check that the network is marked **Private** (`NetworkCategory` column):

```powershell
Get-NetConnectionProfile
```

If it says `Public`, change it in Settings > Network & internet > (your connection) > Private network.
Then open the port:

```powershell
New-NetFirewallRule -DisplayName "Britech Job Entry" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private
```

From a phone on the same Wi-Fi, open `http://Shipping-Bri:8000`. If the name doesn't
resolve, use the PC's IP address (`ipconfig`, the "IPv4 Address" line), e.g.
`http://192.168.1.50:8000`. Ask whoever manages the router to give this PC a fixed
(reserved) IP so that address never changes.

## 10. Start automatically at boot *(admin)*

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\BritechJobEntry\app\scripts\run_server.ps1"'
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$user = "$env:USERDOMAIN\$env:USERNAME"
$password = Read-Host "Windows password for $user"
Register-ScheduledTask -TaskName "Britech Job Entry" -Action $action -Trigger $trigger `
    -Settings $settings -User $user -Password $password
```

- The task runs as this Windows user even when nobody is signed in. If the PC signs in
  with a Microsoft account, use that account's password. If the password changes later,
  update the task (Task Scheduler > Britech Job Entry > Properties > Change User).
- The same user must be able to open the DiskStation share. Open the share once in File
  Explorer and tick "Remember my credentials".

Test it without rebooting: `Start-ScheduledTask "Britech Job Entry"`, then repeat the health check from step 8.

## 11. Keep the PC awake

Settings > System > Power & battery > Screen and sleep: set **"When plugged in, put my
device to sleep after"** to **Never**. The screen may still turn off.

---

## Updating to a new version

```powershell
cd C:\BritechJobEntry\app
powershell -ExecutionPolicy Bypass -File .\scripts\stop_server.ps1
git pull
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
cd frontend; npm ci; npm run build; cd ..
Start-ScheduledTask "Britech Job Entry"
```

Database changes are applied automatically when the server starts.

## Where things are

| What | Where |
|---|---|
| Logs | `C:\BritechJobEntry\logs\server-YYYY-MM.log` |
| PDFs | `C:\BritechJobEntry\pdfs\YYYY\MM\<id>.pdf` (plus the copy in `PDF_BACKUP_DIR`) |
| Data | SQL Server database `BritechJobEntry` on `Shipping-Bri\SQLEXPRESS` |
| Settings | `C:\BritechJobEntry\app\.env` |

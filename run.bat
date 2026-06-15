@echo off
REM Convenience launcher for local development (Windows).
REM Starts PostgreSQL via Docker, applies EF Core migrations, then opens the
REM ASP.NET Core backend and the Vite frontend dev server in their own windows.
REM
REM Usage: double-click run.bat, or run it from a command prompt.

cd /d "%~dp0"

set ConnectionStrings__NetraScope=Host=localhost;Port=5432;Database=netrascope;Username=postgres;Password=password
set Auth__Jwt__Secret=CHANGE_ME_DEV_ONLY_REPLACE_WITH_A_LONG_RANDOM_SECRET
set AllowedHosts=http://localhost:5173

where docker >nul 2>nul
if %errorlevel%==0 (
    echo ==^> Starting PostgreSQL
    docker compose up -d db
) else (
    echo ==^> Docker not found, skipping PostgreSQL startup ^(make sure it is running^)
)

echo ==^> Applying database migrations
dotnet tool restore
dotnet ef database update --project backend\src\NetraScope.Core --startup-project backend\src\NetraScope.Core

if not exist frontend\.env (
    echo VITE_API_BASE_URL=http://localhost:5050 > frontend\.env
)

if not exist frontend\node_modules (
    echo ==^> Installing frontend dependencies
    pushd frontend
    call npm install
    popd
)

echo ==^> Starting backend ^(http://localhost:5050^)
start "NetraScope Backend" cmd /k dotnet run --project backend\src\NetraScope.Core --urls http://localhost:5050

echo ==^> Starting frontend ^(http://localhost:5173^)
start "NetraScope Frontend" cmd /k npm run dev --prefix frontend

// Standalone Windows Packager for Jarvis 2.0 PC Edition (Sans Backend)
// 1. Builds the complete self-contained bundle in dist/
// 2. Creates the portable Windows distribution in release/Jarvis-2.0-Windows-Portable/
//    with a native Windows .exe compiler/launcher (using built-in Windows csc.exe / Edge App Mode / Electron)

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const releaseDir = path.join(rootDir, 'release', 'Jarvis-2.0-Windows-Portable');

console.log('1/3 — Compilation du bundle autonome Jarvis 2.0 (Vite)...');
execSync('npm run build', { stdio: 'inherit', cwd: rootDir });

console.log('2/3 — Préparation du package Windows autonome (sans backend)...');
fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

fs.cpSync(path.join(rootDir, 'dist'), path.join(releaseDir, 'dist'), { recursive: true });
fs.cpSync(path.join(rootDir, 'electron'), path.join(releaseDir, 'electron'), { recursive: true });

// C# source for native standalone Windows .exe (compiled automatically by Windows' built-in csc.exe or launched directly)
const csSource = `using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

class JarvisStandaloneLauncher {
    [STAThread]
    static void Main() {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string distDir = Path.Combine(baseDir, "dist");
        string indexHtml = Path.Combine(distDir, "index.html");

        // If Electron binary is present in local folder, launch it directly
        string electronExe = Path.Combine(baseDir, "node_modules", "electron", "dist", "electron.exe");
        if (File.Exists(electronExe)) {
            Process.Start(new ProcessStartInfo {
                FileName = electronExe,
                Arguments = ".",
                WorkingDirectory = baseDir,
                UseShellExecute = false
            });
            return;
        }

        // Start lightweight embedded static asset reader on loopback so WebAudio/Fetch/3D assets load with zero external backend
        int port = 17531;
        HttpListener listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
        try {
            listener.Start();
            Thread serverThread = new Thread(() => {
                while (listener.IsListening) {
                    try {
                        var ctx = listener.GetContext();
                        string reqPath = ctx.Request.Url.AbsolutePath.TrimStart('/');
                        if (string.IsNullOrEmpty(reqPath)) reqPath = "index.html";
                        string filePath = Path.Combine(distDir, reqPath.Replace('/', Path.DirectorySeparatorChar));
                        if (File.Exists(filePath)) {
                            byte[] bytes = File.ReadAllBytes(filePath);
                            string ext = Path.GetExtension(filePath).ToLowerInvariant();
                            ctx.Response.ContentType =
                                ext == ".html" ? "text/html; charset=utf-8" :
                                ext == ".js" ? "application/javascript; charset=utf-8" :
                                ext == ".css" ? "text/css; charset=utf-8" :
                                ext == ".json" ? "application/json; charset=utf-8" :
                                ext == ".webp" ? "image/webp" :
                                ext == ".png" ? "image/png" : "application/octet-stream";
                            ctx.Response.ContentLength64 = bytes.Length;
                            ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                        } else {
                            ctx.Response.StatusCode = 404;
                        }
                        ctx.Response.Close();
                    } catch { break; }
                }
            });
            serverThread.IsBackground = true;
            serverThread.Start();

            Process appProc = Process.Start(new ProcessStartInfo {
                FileName = "msedge",
                Arguments = "--app=http://127.0.0.1:" + port + " --window-size=1440,900",
                UseShellExecute = true
            });
            if (appProc != null) {
                appProc.WaitForExit();
            } else {
                Application.Run();
            }
        } catch {
            Process.Start(new ProcessStartInfo { FileName = indexHtml, UseShellExecute = true });
        }
    }
}
`;

fs.writeFileSync(path.join(releaseDir, 'JarvisLauncher.cs'), csSource, 'utf8');

const batLauncher = `@echo off
setlocal
cd /d "%~dp0"
if not exist "Jarvis-2.0.exe" (
    echo Generation de Jarvis-2.0.exe autonome...
    if exist "%WINDIR%\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe" (
        "%WINDIR%\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe" /nologo /target:winexe /out:"Jarvis-2.0.exe" "JarvisLauncher.cs"
    )
)
if exist "Jarvis-2.0.exe" (
    start "" "Jarvis-2.0.exe"
) else (
    npx electron .
)
`;

fs.writeFileSync(path.join(releaseDir, 'Lancer-Jarvis-2.0.bat'), batLauncher, 'utf8');

console.log('3/3 — Package Windows autonome généré dans release/Jarvis-2.0-Windows-Portable/');

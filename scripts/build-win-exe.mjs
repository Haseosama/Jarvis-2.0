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
const csSource = String.raw`using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class JarvisStandaloneLauncher {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    static void WriteJson(HttpListenerResponse response, object value) {
        byte[] bytes = Encoding.UTF8.GetBytes(Json.Serialize(value));
        response.ContentType = "application/json; charset=utf-8";
        response.ContentLength64 = bytes.Length;
        response.OutputStream.Write(bytes, 0, bytes.Length);
    }

    static string ReadText(Stream stream) {
        if (stream == null) return "";
        using (StreamReader reader = new StreamReader(stream, Encoding.UTF8)) return reader.ReadToEnd();
    }

    static void Proxy(HttpListenerContext ctx) {
        string input = ReadText(ctx.Request.InputStream);
        try {
            Dictionary<string, object> payload = Json.Deserialize<Dictionary<string, object>>(input);
            string url = Convert.ToString(payload.ContainsKey("url") ? payload["url"] : "");
            string method = Convert.ToString(payload.ContainsKey("method") ? payload["method"] : "GET");
            if (String.IsNullOrWhiteSpace(url) || (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) && !url.StartsWith("http://", StringComparison.OrdinalIgnoreCase))) {
                ctx.Response.StatusCode = 400;
                WriteJson(ctx.Response, new Dictionary<string, object> { { "ok", false }, { "status", 400 }, { "error", "Invalid URL" }, { "text", "" } });
                return;
            }
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = String.IsNullOrWhiteSpace(method) ? "GET" : method.ToUpperInvariant();
            request.UserAgent = "Jarvis-PC/2.0 (Windows NT 10.0; Win64; x64)";
            int timeout = 12000;
            if (payload.ContainsKey("timeoutMs")) Int32.TryParse(Convert.ToString(payload["timeoutMs"]), out timeout);
            request.Timeout = Math.Max(1000, Math.Min(timeout, 60000));
            request.ReadWriteTimeout = request.Timeout;
            Dictionary<string, object> headers = payload.ContainsKey("headers") ? payload["headers"] as Dictionary<string, object> : null;
            if (headers != null) {
                foreach (KeyValuePair<string, object> pair in headers) {
                    string key = pair.Key;
                    string value = Convert.ToString(pair.Value);
                    if (key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase)) request.ContentType = value;
                    else if (key.Equals("Accept", StringComparison.OrdinalIgnoreCase)) request.Accept = value;
                    else if (!key.Equals("User-Agent", StringComparison.OrdinalIgnoreCase) && !key.Equals("Host", StringComparison.OrdinalIgnoreCase)) request.Headers[key] = value;
                }
            }
            string body = payload.ContainsKey("body") && payload["body"] != null ? Convert.ToString(payload["body"]) : "";
            if (request.Method != "GET" && request.Method != "HEAD" && !String.IsNullOrEmpty(body)) {
                byte[] bodyBytes = Encoding.UTF8.GetBytes(body);
                if (String.IsNullOrEmpty(request.ContentType)) request.ContentType = "application/json";
                request.ContentLength = bodyBytes.Length;
                using (Stream stream = request.GetRequestStream()) stream.Write(bodyBytes, 0, bodyBytes.Length);
            }
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse()) {
                string responseBody = ReadText(response.GetResponseStream());
                int status = (int)response.StatusCode;
                WriteJson(ctx.Response, new Dictionary<string, object> { { "ok", status >= 200 && status < 300 }, { "status", status }, { "text", responseBody } });
            }
        } catch (WebException ex) {
            int status = 0;
            string text = "";
            HttpWebResponse response = ex.Response as HttpWebResponse;
            if (response != null) {
                status = (int)response.StatusCode;
                text = ReadText(response.GetResponseStream());
                response.Close();
            }
            WriteJson(ctx.Response, new Dictionary<string, object> { { "ok", false }, { "status", status }, { "error", ex.Message }, { "text", text } });
        } catch (Exception ex) {
            WriteJson(ctx.Response, new Dictionary<string, object> { { "ok", false }, { "status", 0 }, { "error", ex.Message }, { "text", "" } });
        }
    }

    [STAThread]
    static void Main() {
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | (SecurityProtocolType)768 | SecurityProtocolType.Tls;
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string distDir = Path.GetFullPath(Path.Combine(baseDir, "dist"));
        string indexHtml = Path.Combine(distDir, "index.html");
        string electronExe = Path.Combine(baseDir, "node_modules", "electron", "dist", "electron.exe");
        if (File.Exists(electronExe)) {
            Process.Start(new ProcessStartInfo { FileName = electronExe, Arguments = ".", WorkingDirectory = baseDir, UseShellExecute = false });
            return;
        }

        int port = 17531;
        HttpListener listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
        try {
            listener.Start();
            Thread serverThread = new Thread(() => {
                while (listener.IsListening) {
                    try {
                        HttpListenerContext ctx = listener.GetContext();
                        ThreadPool.QueueUserWorkItem(delegate(object state) {
                            HttpListenerContext requestContext = (HttpListenerContext)state;
                            try {
                                string reqPath = requestContext.Request.Url.AbsolutePath.TrimStart('/');
                                if (reqPath.StartsWith("__jarvis_proxy__", StringComparison.Ordinal)) {
                                    Proxy(requestContext);
                                    requestContext.Response.Close();
                                    return;
                                }
                                if (String.IsNullOrEmpty(reqPath)) reqPath = "index.html";
                                string fullPath = Path.GetFullPath(Path.Combine(distDir, reqPath.Replace('/', Path.DirectorySeparatorChar)));
                                string rootPrefix = distDir.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                                if (!fullPath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase) || !File.Exists(fullPath)) {
                                    requestContext.Response.StatusCode = 404;
                                    requestContext.Response.Close();
                                    return;
                                }
                                byte[] bytes = File.ReadAllBytes(fullPath);
                                string ext = Path.GetExtension(fullPath).ToLowerInvariant();
                                requestContext.Response.ContentType = ext == ".html" ? "text/html; charset=utf-8" : ext == ".js" ? "application/javascript; charset=utf-8" : ext == ".css" ? "text/css; charset=utf-8" : ext == ".json" ? "application/json; charset=utf-8" : ext == ".webp" ? "image/webp" : ext == ".png" ? "image/png" : ext == ".bin" ? "application/octet-stream" : "application/octet-stream";
                                requestContext.Response.ContentLength64 = bytes.Length;
                                requestContext.Response.OutputStream.Write(bytes, 0, bytes.Length);
                                requestContext.Response.Close();
                            } catch { try { requestContext.Response.Close(); } catch { } }
                        }, ctx);
                    } catch { break; }
                }
            });
            serverThread.IsBackground = true;
            serverThread.Start();

            string appUrl = "http://127.0.0.1:" + port + "/";
            try {
                Process.Start(new ProcessStartInfo { FileName = "msedge", Arguments = "--app=" + appUrl + " --window-size=1440,900", UseShellExecute = true }).WaitForExit();
            } catch {
                Process.Start(new ProcessStartInfo { FileName = appUrl, UseShellExecute = true });
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
        "%WINDIR%\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe" /nologo /target:winexe /r:System.Windows.Forms.dll /r:"%WINDIR%\\Microsoft.NET\\Framework64\\v4.0.30319\\System.Web.Extensions.dll" /out:"Jarvis-2.0.exe" "JarvisLauncher.cs"
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

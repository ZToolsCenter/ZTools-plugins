import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
/** Build a temporary launch target and a native region probe without touching installed applications. */
export function nativeFixture(root) {
  const marker = join(root, 'launched.txt'), exe = join(root, '程序坞 启动验证.exe'), source = join(root, 'fixture.cs');
  writeFileSync(source, `using System; using System.IO; using System.Runtime.InteropServices;
class Probe {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left,top,right,bottom; }
 [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out int value, int size);
 [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr h, IntPtr r);
 [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int a,int b,int c,int d);
 [DllImport("gdi32.dll")] static extern int GetRgnBox(IntPtr r, out RECT b);
 [DllImport("gdi32.dll")] static extern bool PtInRegion(IntPtr r, int x, int y);
 [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
 [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);
 [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT b);
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint command);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 static bool IsAbove(IntPtr window, IntPtr other) { for(IntPtr w=GetWindow(window,3);w!=IntPtr.Zero;w=GetWindow(w,3)) if(w==other) return true; return false; }
 static void Main(string[] args) {
  if (args.Length == 0) { File.WriteAllText(${JSON.stringify(marker)}, "launched"); return; }
  SetProcessDpiAwarenessContext(new IntPtr(-4));
  IntPtr h=new IntPtr(long.Parse(args[0])), r=CreateRectRgn(0,0,0,0); RECT box, client; int kind=GetWindowRgn(h,r); GetRgnBox(r,out box); bool contains=args.Length>3 && PtInRegion(r,int.Parse(args[2]),int.Parse(args[3])); DeleteObject(r); GetClientRect(h,out client);
  int material; int materialResult=DwmGetWindowAttribute(h,38,out material,4);
  bool otherAbove = args.Length > 1 && IsAbove(h, new IntPtr(long.Parse(args[1])));
  Console.WriteLine("{\\"material\\":"+material+",\\"materialResult\\":"+materialResult+",\\"kind\\":"+kind+",\\"width\\":"+(box.right-box.left)+",\\"height\\":"+(box.bottom-box.top)+",\\"clientWidth\\":"+client.right+",\\"clientHeight\\":"+client.bottom+",\\"dpi\\":"+GetDpiForWindow(h)+",\\"contains\\":"+contains.ToString().ToLower()+",\\"otherAbove\\":"+otherAbove.ToString().ToLower()+",\\"foreground\\":\\""+GetForegroundWindow().ToInt64()+"\\"}");
 }
}`);
  const result = spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe', ['/nologo', '/target:winexe', `/out:${exe}`, source], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Fixture compile failed: ${result.stdout} ${result.stderr}`);
  return { marker, exe, probe(handle, other, point) { const args = point ? [handle,other || '0',String(point.x),String(point.y)] : other ? [handle,other] : [handle]; const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true }); if (r.status !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout.trim()); } };
}

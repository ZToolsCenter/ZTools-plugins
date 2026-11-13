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
 [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
 [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
 [DllImport("gdi32.dll")] static extern uint GetPixel(IntPtr dc,int x,int y);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] static extern bool GetWindowDisplayAffinity(IntPtr h,out uint value);
 static bool IsAbove(IntPtr window, IntPtr other) { for(IntPtr w=GetWindow(window,3);w!=IntPtr.Zero;w=GetWindow(w,3)) if(w==other) return true; return false; }
 static void Main(string[] args) {
  if (args.Length == 0) { File.WriteAllText(${JSON.stringify(marker)}, "launched"); return; }
  SetProcessDpiAwarenessContext(new IntPtr(-4));
  if(args[0]=="locked"){uint pid;GetWindowThreadProcessId(GetForegroundWindow(),out pid);Console.WriteLine((System.Diagnostics.Process.GetProcessById((int)pid).ProcessName=="LockApp").ToString().ToLower());return;}
  if(args[0]=="flags"){var hwnd=new IntPtr(long.Parse(args[1]));uint a;GetWindowDisplayAffinity(hwnd,out a);int c;DwmGetWindowAttribute(hwnd,14,out c,4);Console.WriteLine("["+a+","+c+","+GetForegroundWindow().ToInt64()+"]");return;}
  if(args[0]=="pixels") { var dc=GetDC(IntPtr.Zero); var colors=new System.Collections.Generic.List<string>();try {for(int i=1;i<args.Length;i+=2){uint c=GetPixel(dc,int.Parse(args[i]),int.Parse(args[i+1]));if(c==0xffffffff)throw new Exception("Screen pixel unavailable");colors.Add("["+((c>>16)&255)+","+((c>>8)&255)+","+(c&255)+"]");}}finally{ReleaseDC(IntPtr.Zero,dc);}Console.WriteLine("["+string.Join(",",colors)+"]");return; }
  IntPtr h=new IntPtr(long.Parse(args[0])), r=CreateRectRgn(0,0,0,0); RECT box, client; int kind=GetWindowRgn(h,r); GetRgnBox(r,out box); bool contains=args.Length>3 && PtInRegion(r,int.Parse(args[2]),int.Parse(args[3])); DeleteObject(r); GetClientRect(h,out client);
  int material; int materialResult=DwmGetWindowAttribute(h,38,out material,4);
  bool otherAbove = args.Length > 1 && IsAbove(h, new IntPtr(long.Parse(args[1])));
  Console.WriteLine("{\\"material\\":"+material+",\\"materialResult\\":"+materialResult+",\\"kind\\":"+kind+",\\"width\\":"+(box.right-box.left)+",\\"height\\":"+(box.bottom-box.top)+",\\"clientWidth\\":"+client.right+",\\"clientHeight\\":"+client.bottom+",\\"dpi\\":"+GetDpiForWindow(h)+",\\"contains\\":"+contains.ToString().ToLower()+",\\"otherAbove\\":"+otherAbove.ToString().ToLower()+",\\"foreground\\":\\""+GetForegroundWindow().ToInt64()+"\\"}");
 }
}`);
  const result = spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe', ['/nologo', '/target:winexe', `/out:${exe}`, source], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Fixture compile failed: ${result.stdout} ${result.stderr}`);
  return { marker, exe, desktopLocked() {return JSON.parse(spawnSync(exe,['locked'],{encoding:'utf8',windowsHide:true}).stdout.trim());}, flags(handle) {return JSON.parse(spawnSync(exe,['flags',handle],{encoding:'utf8',windowsHide:true}).stdout.trim());}, pixels(points) { const r=spawnSync(exe,['pixels',...points.flatMap(p=>[String(Math.round(p.x)),String(Math.round(p.y))])],{encoding:'utf8',windowsHide:true,timeout:10000});if(r.status!==0)throw Error(r.stderr||r.error);return JSON.parse(r.stdout.trim()); }, probe(handle, other, point) { const args = point ? [handle,other || '0',String(point.x),String(point.y)] : other ? [handle,other] : [handle]; const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true }); if (r.status !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout.trim()); } };
}

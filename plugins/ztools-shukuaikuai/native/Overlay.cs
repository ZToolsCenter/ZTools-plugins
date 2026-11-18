using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Threading;
using System.Runtime.InteropServices;
using System.Drawing.Imaging;
using System.Windows.Forms;

// Frames never reference the mutable input session. Only this STA thread draws windows.
sealed class WheelVisual {
 public int Radius,Center,InnerCount,SecondCount,OutsideCount;public bool Second,Outside;public string[] Labels,Images;
 public Color Color;public double Opacity;
}
sealed class RenderFrame {
 public string Kind="idle",Hint="",Icon="";public Point Center,Cursor;public Point[] Points;
 public Point[][] Strokes;public float Dpi=1;public int Selected=-1,Width;public bool Trail;public Color Color;public WheelVisual Wheel;
}
sealed class OverlayPump:IDisposable {
 RenderFrame latest;Thread worker;Form dispatch;ManualResetEvent ready=new ManualResetEvent(false);volatile bool stopped;
 public long Paints;public double MaxPaintMs;
 public OverlayPump(){worker=new Thread(Run);worker.IsBackground=true;worker.SetApartmentState(ApartmentState.STA);worker.Start();if(!ready.WaitOne(4000))throw new Exception("绘制线程启动超时");}
 void Run(){using(var view=new OverlayView(this)){dispatch=view;var handle=view.Handle;using(var timer=new System.Windows.Forms.Timer()){timer.Interval=16;timer.Tick+=(s,e)=>{var frame=Interlocked.Exchange(ref latest,null);if(frame!=null)view.Apply(frame);view.ExpireFeedback();};timer.Start();ready.Set();Application.Run();}}}
 public void Submit(RenderFrame frame){if(!stopped)Interlocked.Exchange(ref latest,frame);}
 public void Clear(){Submit(new RenderFrame());}
 public void Dispose(){if(stopped)return;stopped=true;try{dispatch.BeginInvoke((Action)(()=>{dispatch.Close();Application.ExitThread();}));}catch{}worker.Join(1500);ready.Dispose();}
}
sealed class OverlayView:Form {
 readonly OverlayPump stats;RenderFrame frame=new RenderFrame();Font font,small;float fontDpi;Rectangle gestureBounds;DateTime feedbackUntil;
 public OverlayView(OverlayPump owner){stats=owner;FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;}
 protected override bool ShowWithoutActivation{get{return true;}}
 protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x08000000|0x20|0x80|0x80000;return p;}}
 protected override void OnPaint(PaintEventArgs e){}
 protected override void OnPaintBackground(PaintEventArgs e){}
 public void ExpireFeedback(){if(frame.Kind=="feedback"&&DateTime.UtcNow>=feedbackUntil){Hide();frame=new RenderFrame();}}
 public void Apply(RenderFrame next){var previous=frame.Kind;frame=next;if(next.Kind!="wheel"&&next.Kind!="gesture"&&next.Kind!="feedback"){Hide();gestureBounds=Rectangle.Empty;return;}
  if(font==null||fontDpi!=next.Dpi){if(font!=null){font.Dispose();small.Dispose();}fontDpi=next.Dpi;font=new Font("Microsoft YaHei UI",11*fontDpi,FontStyle.Regular,GraphicsUnit.Pixel);small=new Font("Microsoft YaHei UI",10*fontDpi,FontStyle.Regular,GraphicsUnit.Pixel);}
  Rectangle bounds;if(next.Kind=="feedback"){var area=Screen.FromPoint(next.Cursor).WorkingArea;int width=(int)(320*next.Dpi),height=(int)(54*next.Dpi);bounds=new Rectangle(Math.Max(area.Left,Math.Min(area.Right-width,next.Cursor.X+16)),Math.Max(area.Top,Math.Min(area.Bottom-height,next.Cursor.Y+20)),width,height);feedbackUntil=DateTime.UtcNow.AddMilliseconds(1400);}
  else if(next.Kind=="wheel"){int r=next.Wheel.Radius+(int)(14*next.Dpi);bounds=new Rectangle(next.Center.X-r,next.Center.Y-r,r*2,r*2);gestureBounds=Rectangle.Empty;}
  else{if(!next.Trail||next.Points==null||next.Points.Length<2){Hide();return;}int left=next.Points[0].X,top=next.Points[0].Y,right=left,bottom=top;foreach(var p in next.Points){left=Math.Min(left,p.X);top=Math.Min(top,p.Y);right=Math.Max(right,p.X);bottom=Math.Max(bottom,p.Y);}right=Math.Max(right,next.Cursor.X+240);bottom=Math.Max(bottom,next.Cursor.Y+60);var region=Rectangle.FromLTRB((int)Math.Floor((left-12)/128.0)*128,(int)Math.Floor((top-12)/128.0)*128,(int)Math.Ceiling((right+12)/128.0)*128,(int)Math.Ceiling((bottom+12)/128.0)*128);gestureBounds=previous!="gesture"?region:Rectangle.Union(gestureBounds,region);bounds=gestureBounds;}
  var watch=System.Diagnostics.Stopwatch.StartNew();try{using(var bitmap=new Bitmap(bounds.Width,bounds.Height,PixelFormat.Format32bppPArgb))using(var g=Graphics.FromImage(bitmap)){g.Clear(Color.Transparent);g.SmoothingMode=SmoothingMode.AntiAlias;g.TextRenderingHint=System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;g.TranslateTransform(-bounds.Left,-bounds.Top);if(frame.Kind=="wheel")WheelPainter.Draw(g,frame,font,small);else if(frame.Kind=="feedback"){using(var b=new SolidBrush(Color.FromArgb(244,248,249)))g.FillRectangle(b,bounds);using(var b=new SolidBrush(Color.FromArgb(47,68,74)))using(var format=new StringFormat{Alignment=StringAlignment.Center,LineAlignment=StringAlignment.Center,Trimming=StringTrimming.EllipsisCharacter}){var box=new RectangleF(bounds.X,bounds.Y,bounds.Width,bounds.Height);var icon=WheelPainter.IconImage(frame.Icon);if(icon!=null){float size=24*frame.Dpi;g.DrawImage(icon,bounds.X+12*frame.Dpi,bounds.Y+(bounds.Height-size)/2,size,size);box.X+=42*frame.Dpi;box.Width-=48*frame.Dpi;}g.DrawString(frame.Hint,font,b,box,format);}}else{using(var pen=new Pen(frame.Color,frame.Width)){pen.StartCap=LineCap.Round;pen.EndCap=LineCap.Round;if(frame.Strokes!=null){foreach(var stroke in frame.Strokes)if(stroke.Length>1)g.DrawLines(pen,stroke);}else g.DrawLines(pen,frame.Points);}using(var b=new SolidBrush(Color.FromArgb(40,53,65)))g.DrawString(frame.Hint,font,b,frame.Cursor.X+18,frame.Cursor.Y+18);}Bounds=bounds;AlphaSurface.Upload(Handle,bitmap,bounds,frame.Kind=="wheel"?frame.Wheel.Opacity:1);if(!Visible)Show();}}finally{watch.Stop();stats.Paints++;stats.MaxPaintMs=Math.Max(stats.MaxPaintMs,watch.Elapsed.TotalMilliseconds);}
 }
 protected override void Dispose(bool disposing){if(disposing){if(font!=null)font.Dispose();if(small!=null)small.Dispose();}base.Dispose(disposing);}
}
static class WheelPainter {
 static Color Ink=Color.FromArgb(45,57,69);
 static System.Collections.Generic.Dictionary<string,Bitmap> imageCache=new System.Collections.Generic.Dictionary<string,Bitmap>();
 public static Bitmap IconImage(string data){if(String.IsNullOrEmpty(data)||data.Length>100000||!data.StartsWith("data:image/png;base64,"))return null;Bitmap found;if(imageCache.TryGetValue(data,out found))return found;try{using(var stream=new System.IO.MemoryStream(Convert.FromBase64String(data.Substring(data.IndexOf(',')+1))))using(var source=Image.FromStream(stream)){if(source.Width>256||source.Height>256)return null;found=new Bitmap(source);}if(imageCache.Count>=128){foreach(var b in imageCache.Values)if(b!=null)b.Dispose();imageCache.Clear();}imageCache[data]=found;return found;}catch{return null;}}

 public static void Draw(Graphics g,RenderFrame f,Font font,Font small){var w=f.Wheel;float boundary=w.Center+(w.Radius-w.Center)*.5f;var disk=new RectangleF(f.Center.X-w.Radius,f.Center.Y-w.Radius,w.Radius*2,w.Radius*2);
  for(int i=10;i>=1;i--){float inset=i*f.Dpi;using(var b=new SolidBrush(Color.FromArgb(2,27,46,57)))g.FillEllipse(b,disk.X-inset,disk.Y-inset,disk.Width+inset*2,disk.Height+inset*2);}
  using(var b=new SolidBrush(Color.FromArgb(249,251,252)))g.FillEllipse(b,disk);
  int offset=0;for(int ring=0;ring<(w.Second?2:1);ring++){int count=ring==0?w.InnerCount:w.SecondCount;float inner=ring==0?w.Center+3*f.Dpi:boundary+2*f.Dpi,outer=ring==0&&w.Second?boundary-2*f.Dpi:w.Radius-3*f.Dpi;float step=360f/count;
   for(int i=0;i<count;i++){bool selected=f.Selected==offset+i;using(var path=Sector(f.Center,inner,outer,-90+(i-.5f)*step+1.1f,step-2.2f))using(var fill=new SolidBrush(selected?Color.FromArgb(226,243,242):Color.White))using(var line=new Pen(selected?Color.FromArgb(150,w.Color):Color.FromArgb(232,237,240),selected?1.25f:1f)){g.FillPath(fill,path);g.DrawPath(line,path);}double angle=(-90+i*step)*Math.PI/180;float radius=(inner+outer)/2;var box=new RectangleF(f.Center.X+(float)Math.Cos(angle)*radius-36*f.Dpi,f.Center.Y+(float)Math.Sin(angle)*radius-19*f.Dpi,72*f.Dpi,38*f.Dpi);var icon=w.Images!=null&&offset+i<w.Images.Length?IconImage(w.Images[offset+i]):null;if(icon!=null){float size=16*f.Dpi;g.DrawImage(icon,box.X+(box.Width-size)/2,box.Y+1*f.Dpi,size,size);box.Y+=19*f.Dpi;box.Height=19*f.Dpi;}
using(var brush=new SolidBrush(selected?w.Color:Ink))using(var fmt=new StringFormat{Alignment=StringAlignment.Center,LineAlignment=StringAlignment.Center,Trimming=StringTrimming.EllipsisCharacter})g.DrawString(w.Labels[offset+i],font,brush,box,fmt);
   }offset+=count;
  }
  bool outside=w.Outside&&f.Selected>=offset;if(outside)using(var pen=new Pen(Color.FromArgb(180,w.Color),2*f.Dpi))g.DrawEllipse(pen,disk);
  using(var fill=new SolidBrush(Color.White))g.FillEllipse(fill,f.Center.X-w.Center+3*f.Dpi,f.Center.Y-w.Center+3*f.Dpi,(w.Center-3*f.Dpi)*2,(w.Center-3*f.Dpi)*2);
  var outsideIcon=outside&&w.Images!=null&&f.Selected<w.Images.Length?IconImage(w.Images[f.Selected]):null;if(outsideIcon!=null)g.DrawImage(outsideIcon,f.Center.X-8*f.Dpi,f.Center.Y-26*f.Dpi,16*f.Dpi,16*f.Dpi);
  string title=outside?"外圈":"鼠快快",subtitle=outside&&f.Selected<w.Labels.Length?w.Labels[f.Selected]:"松开取消";
  using(var b=new SolidBrush(outside?w.Color:Ink))using(var fmt=new StringFormat{Alignment=StringAlignment.Center,LineAlignment=StringAlignment.Center,Trimming=StringTrimming.EllipsisCharacter}){g.DrawString(title,font,b,new RectangleF(f.Center.X-w.Center,f.Center.Y-(outsideIcon!=null?8:18)*f.Dpi,w.Center*2,22*f.Dpi),fmt);g.DrawString(subtitle,small,b,new RectangleF(f.Center.X-w.Center,f.Center.Y+(outsideIcon!=null?12:3)*f.Dpi,w.Center*2,21*f.Dpi),fmt);}
 }
 static GraphicsPath Sector(Point center,float inner,float outer,float angle,float sweep){var p=new GraphicsPath();p.AddArc(center.X-outer,center.Y-outer,outer*2,outer*2,angle,sweep);p.AddArc(center.X-inner,center.Y-inner,inner*2,inner*2,angle+sweep,-sweep);p.CloseFigure();return p;}
}
static class AlphaSurface {
 [StructLayout(LayoutKind.Sequential)]struct PT{public int X,Y;public PT(int x,int y){X=x;Y=y;}}
 [StructLayout(LayoutKind.Sequential)]struct SZ{public int W,H;public SZ(int w,int h){W=w;H=h;}}
 [StructLayout(LayoutKind.Sequential,Pack=1)]struct BLEND{public byte Op,Flags,Alpha,Format;}
 [DllImport("user32.dll")]static extern IntPtr GetDC(IntPtr h);[DllImport("user32.dll")]static extern int ReleaseDC(IntPtr h,IntPtr dc);
 [DllImport("gdi32.dll")]static extern IntPtr CreateCompatibleDC(IntPtr dc);[DllImport("gdi32.dll")]static extern bool DeleteDC(IntPtr dc);[DllImport("gdi32.dll")]static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);[DllImport("gdi32.dll")]static extern bool DeleteObject(IntPtr obj);
 [DllImport("user32.dll",SetLastError=true)]static extern bool UpdateLayeredWindow(IntPtr h,IntPtr dest,ref PT pos,ref SZ size,IntPtr source,ref PT sourcePos,uint key,ref BLEND blend,uint flags);
 public static void Upload(IntPtr window,Bitmap bitmap,Rectangle bounds,double opacity){IntPtr screen=GetDC(IntPtr.Zero),memory=CreateCompatibleDC(screen),image=IntPtr.Zero,old=IntPtr.Zero;try{image=bitmap.GetHbitmap(Color.FromArgb(0));old=SelectObject(memory,image);var position=new PT(bounds.Left,bounds.Top);var size=new SZ(bitmap.Width,bitmap.Height);var origin=new PT();var blend=new BLEND{Alpha=(byte)Math.Round(Math.Max(0,Math.Min(1,opacity))*255),Format=1};if(!UpdateLayeredWindow(window,screen,ref position,ref size,memory,ref origin,0,ref blend,2))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());}finally{if(old!=IntPtr.Zero)SelectObject(memory,old);if(image!=IntPtr.Zero)DeleteObject(image);DeleteDC(memory);ReleaseDC(IntPtr.Zero,screen);}}
}

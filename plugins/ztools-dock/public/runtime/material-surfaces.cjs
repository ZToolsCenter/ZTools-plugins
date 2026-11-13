'use strict';
// DWM ignores the large canvas' visual shape on some Windows/Electron versions.
// Give each visible rectangle its own strictly-sized native backdrop instead.
function createMaterialSurfaces(api) {
  let material = 'solid', windows = [], shown = [], layouts = [];
  function live(win) { return win && !win.isDestroyed(); }
  function dispose() {
    for (const win of windows) if (live(win)) win.destroy();
    windows = []; shown = []; layouts = []; material = 'solid';
  }
  function setMaterial(next, common) {
    if (next === material) return false;
    dispose(); material = next;
    if (next !== 'solid') for (const surface of ['bar','tray']) {
      const win = api.createBrowserWindow(`material.html?surface=material-${surface}`, { ...common, width:128, height:64, transparent:false, backgroundColor:'#00000000', backgroundMaterial:next, hasShadow:false, focusable:false, title:'程序坞材质', webPreferences:{backgroundThrottling:true} });
      win.setIgnoreMouseEvents(true); windows.push(win); shown.push(false); layouts.push('');
    }
    return true;
  }
  function layout(rects, panel, expanded, trayVisible) {
    windows.forEach((win,index)=>{
      if (!live(win)) return;
      const rect=rects[index], visible=expanded && (index===0 || trayVisible) && Boolean(rect);
      if (visible) {
        const bounds={x:Math.round(panel.x+rect.x),y:Math.round(panel.y+rect.y),width:rect.width,height:rect.height}, key=JSON.stringify(bounds);
        if(layouts[index]!==key){win.setBounds(bounds);layouts[index]=key;}
        if(!shown[index]){win.showInactive();shown[index]=true;}
      } else if(shown[index]){win.hide();shown[index]=false;}
    });
  }
  function raise(){windows.forEach((win,index)=>{if(shown[index]&&live(win)){win.setAlwaysOnTop(true,'screen-saver');win.moveTop();}});}
  return {setMaterial,layout,raise,dispose};
}
module.exports={createMaterialSurfaces};

const button=document.getElementById("mobile-install");
const dialog=document.getElementById("mobile-install-help");
const mode=matchMedia("(display-mode: standalone)");
const ios=/iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
const android=/Android/i.test(navigator.userAgent);
let promptEvent=null, installed=false;

function update(){
  button.hidden=installed || mode.matches || navigator.standalone===true || !window.isSecureContext;
}

window.addEventListener("beforeinstallprompt",event=>{
  event.preventDefault();
  promptEvent=event;
  update();
});
window.addEventListener("appinstalled",()=>{
  installed=true; promptEvent=null;
  if(dialog.open)dialog.close();
  update();
});
mode.addEventListener("change",update);

button.addEventListener("click",async ()=>{
  if(promptEvent){
    const event=promptEvent;
    promptEvent=null;
    try {
      await event.prompt();
      const choice=await event.userChoice;
      if(choice.outcome==="accepted")installed=true;
      update();
      return;
    }catch { /* The browser menu remains available if the prompt expires. */ }
  }
  document.getElementById("install-steps").textContent=ios
    ? "Safari에서 공유 → 홈 화면에 추가를 선택하세요. ‘웹 앱으로 열기’가 보이면 켠 뒤 추가하세요."
    : android ? "Chrome의 ⋮ 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택하세요. ‘설치 및 바로가기 만들기’ 안에 있을 수도 있습니다."
    : "Chrome 또는 Edge의 주소창이나 메뉴에서 앱 설치를 선택하세요. Mac Safari에서는 파일 → Dock에 추가를 선택하세요. 휴대폰에 설치하려면 휴대폰 브라우저에서 이 페이지를 여세요.";
  dialog.showModal();
});
update();

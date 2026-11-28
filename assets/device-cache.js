const clock = new Intl.DateTimeFormat("ko-KR", {
  timeZone:"Asia/Seoul", dateStyle:"short", timeStyle:"short"
});
export function savedTime(at) {
  return Number.isFinite(at) ? clock.format(at) + " KST" : "";
}

let database;
function openDatabase() {
  return database ??= new Promise((resolve,reject)=>{
    const request=indexedDB.open("jm-invest-device-cache",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("snapshots");
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  }).catch(()=>null);
}

export function createDeviceCache() {
  let scope=null, persist=false;
  const transient=new Map();
  async function readDisk(key) {
    const db=await openDatabase();
    if (!db) return null;
    return new Promise(resolve=>{
      const request=db.transaction("snapshots").objectStore("snapshots").get(key);
      request.onsuccess=()=>resolve(request.result ?? null);
      request.onerror=()=>resolve(null);
    }).catch(()=>null);
  }
  async function writeDisk(key,value) {
    const db=await openDatabase();
    if (!db) return;
    return new Promise(resolve=>{
      const tx=db.transaction("snapshots","readwrite");
      tx.objectStore("snapshots").put(value,key);
      tx.oncomplete=tx.onabort=tx.onerror=()=>resolve();
    }).catch(()=>{});
  }
  const storageKey=(key,isPublic)=>isPublic ? "public/"+key : scope && scope+"/"+key;
  return {
    setAccount(id,remember) {
      transient.clear();
      scope=id;
      persist=remember;
    },
    async read(key,isPublic=false) {
      const id=storageKey(key,isPublic);
      if (!id) return null;
      if (!isPublic && !persist) return transient.get(id) ?? null;
      const value=await readDisk(id);
      return storageKey(key,isPublic)===id ? value : null;
    },
    async write(key,value,isPublic=false) {
      const id=storageKey(key,isPublic);
      if (!id) return;
      if (isPublic || persist) await writeDisk(id,value);
      else transient.set(id,value);
    }
  };
}

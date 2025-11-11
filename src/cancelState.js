// @ts-check
const CancelState = {
  _req: null,
  _running: false,
  _cancelled: false,
  activeUri: null,
  activeLine: null,
  setRequest(req){ this._req=req; this._running=!!req; this._cancelled=false; },
  setRunning(v){ this._running=!!v; },
  isRunning(){ return this._running; },
  setActive(uri,line){ this.activeUri=uri; this.activeLine=line; },
  clearActive(){ this.activeUri=null; this.activeLine=null; },
  cancel(){
    try{
      this._cancelled=true;
      if(this._req && this._req.destroy) this._req.destroy(new Error('Cancelled'));
    }catch{} finally{ this._running=false; }
  }
};

module.exports = CancelState;

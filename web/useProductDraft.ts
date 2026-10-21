import {useEffect,useRef,useState} from 'react';
import {api} from './api';
export function useProductDraft(key:string,value:any,restore:(value:any)=>void){
 const [message,setMessage]=useState('Loading saved draft…'),[ready,setReady]=useState(false);const version=useRef<string|null>(null),chain=useRef(Promise.resolve()),stopped=useRef(false);const latest=useRef(value);latest.current=value;
 useEffect(()=>{let active=true;api('/vendor/drafts/'+key).then(r=>{if(!active)return;version.current=r.version;if(r.data)restore(r.data);setReady(true);setMessage(r.data?'Saved draft restored.':'Changes will be saved automatically.');}).catch(()=>{if(active){setMessage('Server draft unavailable. A copy is kept on this device.');}});return()=>{active=false;};},[key]);
 useEffect(()=>{if(!ready||stopped.current)return;setMessage('Saving draft…');const timer=setTimeout(()=>{const data=latest.current;chain.current=chain.current.then(async()=>{if(stopped.current)return;const r=await api('/vendor/drafts/'+key,{version:version.current,data},'PUT');version.current=r.version;setMessage('Draft saved to your store. Publication requires Save product.');}).catch(e=>{stopped.current=true;setMessage(e.message+' A copy remains on this device.');});},700);return()=>clearTimeout(timer);},[value,ready,key]);
 return {message,clear:async()=>{stopped.current=true;await chain.current;if(version.current)await api('/vendor/drafts/'+key,{version:version.current},'DELETE');}};
}

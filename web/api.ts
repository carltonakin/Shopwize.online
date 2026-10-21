export let csrf='';
export function setCsrf(value:string){csrf=value;}
export async function api(path:string,body?:unknown,method?:string,headers:Record<string,string>={}){
 const form=body instanceof FormData;
 const response=await fetch(`/api${path}`,{method:method||(body===undefined?'GET':'POST'),headers:{...(!form?{'Content-Type':'application/json'}:{}),'X-CSRF-Token':csrf,...headers},body:body===undefined?undefined:form?body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Something went wrong. Please try again.');return data;
}
export const money=(value:string|number,currency='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency}).format(Number(value||0));
export function go(path:string){history.pushState({},'',path);window.dispatchEvent(new PopStateEvent('popstate'));window.scrollTo({top:0,behavior:'instant'});}

import {z} from 'zod';
import {minor,amount} from '../money.js';
import {assert} from '../util.js';
const money=z.string().regex(/^\d{1,12}(\.\d{1,4})?$/);
const rate=z.object({standard:money,express:z.union([money,z.literal(false)]),freeOver:money,estimate:z.string().min(2).max(100).default('3–6 business days')});
export const shippingSchema=rate.extend({pickup:z.boolean(),pickupAddress:z.string().max(500).default(''),countries:z.array(z.string().regex(/^[A-Z]{2}$/)).max(200),zones:z.array(rate.extend({name:z.string().min(2).max(80),countries:z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(200),regions:z.array(z.string().max(100)).max(100).default([]),postalPrefixes:z.array(z.string().min(1).max(20)).max(100).default([])})).max(30).default([])});
export function deliveryMethods(settings:any,address:{country:string;region:string;postal:string}|undefined,net:bigint,currency:string,name:string){
 const selected=address?(settings.zones||[]).find((z:any)=>z.countries.includes(address.country)&&(!z.regions.length||z.regions.some((r:string)=>r.toLowerCase()===address.region.toLowerCase()))&&(!z.postalPrefixes.length||z.postalPrefixes.some((p:string)=>address.postal.toUpperCase().startsWith(p.toUpperCase())))):undefined;
 if(address&&settings.zones?.length)assert(selected,`${name} does not deliver to this address. Choose a supported delivery address.`);
 if(address&&!settings.zones?.length&&settings.countries?.length)assert(settings.countries.includes(address.country),`${name} does not deliver to that country.`);
 const r=selected||settings;
 return [{id:'standard',name:selected?`${selected.name} delivery`:'Standard delivery',estimate:r.estimate||'3–6 business days',price:net>=minor(r.freeOver??'100',currency)?'0':r.standard??'6.00'},...(r.express!==false?[{id:'express',name:'Express delivery',estimate:'1–2 business days',price:r.express??'14.00'}]:[]),...(settings.pickup?[{id:'pickup',name:'Store pickup',estimate:settings.pickupAddress||'Ready in 1–3 business days',price:'0'}]:[])].map(m=>({...m,price:amount(minor(m.price,currency),currency)}));
}

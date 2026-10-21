import {query,transaction,parse} from '../db.js';
import {amount,minor} from '../money.js';
import {id,assert} from '../util.js';
import {stripeClient,paypalApi} from '../payments/providers.js';
export type VerifiedDispute={provider:'stripe'|'paypal';externalId:string;captureId:string;currency:string;amount:string;state:string;reason?:string;dueAt?:number;balanceTransactions?:{id:string;currency:string;amount:string;fee:string;net:string}[]};
// Only provider reconciliation calls this function. Browser data is never financial evidence.
export async function applyVerifiedDispute(d:VerifiedDispute){
 return transaction(async tx=>{
  const capture=(await query("SELECT * FROM PaymentTransactions WHERE provider=@provider AND (externalId=@capture OR JSON_VALUE(data,'$.sourceCharge')=@capture) AND kind='capture'",{provider:d.provider,capture:d.captureId},tx))[0];assert(capture,'Disputed capture has not been reconciled yet.',409);
  const old=(await query('SELECT * FROM Disputes WITH(UPDLOCK,HOLDLOCK) WHERE provider=@provider AND externalId=@external',{provider:d.provider,external:d.externalId},tx))[0];
  const values={id:old?.id||id(),order:capture.orderId,provider:d.provider,external:d.externalId,currency:d.currency,amount:d.amount,state:d.state,data:{reason:d.reason,dueAt:d.dueAt,captureId:d.captureId,liability:'Host suspense until finance reviews provider evidence and the agreed seller policy.'}};
  if(old)await query('UPDATE Disputes SET state=@state,data=@data,updatedAt=SYSUTCDATETIME() WHERE id=@id',values,tx);
  else await query('INSERT INTO Disputes(id,orderId,provider,externalId,currency,amount,state,data) VALUES(@id,@order,@provider,@external,@currency,@amount,@state,@data)',values,tx);
  const closed=['won','lost','warning_closed','RESOLVED'].includes(d.state);
  if(!closed)await query("UPDATE Transfers SET state='held_for_dispute' WHERE state='pending' AND vendorOrderId IN(SELECT id FROM VendorOrders WHERE orderId=@order)",{order:capture.orderId},tx);
  // Record provider balance movements exactly in their settlement currency. Do not invent a seller debit or rewrite commission history.
  for(const b of d.balanceTransactions||[]){
   const source=`dispute_balance:${d.provider}:${b.id}`;if((await query('SELECT id FROM LedgerEntries WHERE source=@source',{source},tx)).length)continue;
   const gross=minor(b.amount,b.currency),fee=minor(b.fee,b.currency),net=minor(b.net,b.currency);assert(net===gross-fee,'Provider dispute balance does not reconcile.');const journal=id();
   for(const [account,value] of [['processor',net],['dispute_suspense',-gross],['processing_fees',fee]] as [string,bigint][]){await query('INSERT INTO LedgerEntries(id,journalId,orderId,account,currency,amount,source) VALUES(@id,@journal,@order,@account,@currency,@amount,@source)',{id:id(),journal,order:capture.orderId,account,currency:b.currency,amount:amount(value,b.currency),source},tx);}
  }
  if(!old)await query("INSERT INTO OutboxMessages(id,type,source,data) VALUES(@id,'dispute',@source,@data)",{id:id(),source:`dispute:${values.id}`,data:{orderId:capture.orderId,state:'A payment dispute is being reviewed. Contact marketplace support.'}},tx);
  return values.id;
 });
}
export async function reconcileDispute(provider:string,externalId:string){
 if(provider==='stripe'){
  const d=await stripeClient().disputes.retrieve(externalId);const charge=typeof d.charge==='string'?d.charge:d.charge.id;
  return applyVerifiedDispute({provider:'stripe',externalId:d.id,captureId:charge,currency:d.currency.toUpperCase(),amount:amount(BigInt(d.amount),d.currency.toUpperCase()),state:d.status,reason:d.reason,dueAt:d.evidence_details.due_by??undefined,balanceTransactions:d.balance_transactions.map(b=>({id:b.id,currency:b.currency.toUpperCase(),amount:amount(BigInt(b.amount),b.currency.toUpperCase()),fee:amount(BigInt(b.fee),b.currency.toUpperCase()),net:amount(BigInt(b.net),b.currency.toUpperCase())}))});
 }
 assert(provider==='paypal','Unsupported dispute provider.');const d=await paypalApi(`/v1/customer/disputes/${encodeURIComponent(externalId)}`);const captureId=d.disputed_transactions?.[0]?.seller_transaction_id;assert(captureId,'PayPal did not provide a seller capture ID.');
 return applyVerifiedDispute({provider:'paypal',externalId:d.dispute_id,captureId,currency:d.dispute_amount.currency_code,amount:d.dispute_amount.value,state:d.status,reason:d.reason});
}
export async function financeQueues(){return {disputes:(await query('SELECT *,CAST(amount AS varchar(40)) AS amountValue FROM Disputes ORDER BY updatedAt DESC')).map(d=>({...d,data:parse(d.data)})),transfers:await query('SELECT t.*,vo.vendorId,vo.orderId,CAST(t.amount AS varchar(40)) AS amountValue FROM Transfers t JOIN VendorOrders vo ON vo.id=t.vendorOrderId'),refunds:await query('SELECT id,orderId,state,providerId,attempts,lastError FROM Refunds'),webhooks:await query("SELECT id,provider,externalId,state,attempts,error FROM WebhookEvents WHERE state<>'processed'"),outbox:await query("SELECT id,type,state,attempts,lastError FROM OutboxMessages WHERE attempts>=8 AND state='pending'")};}

import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { query, transaction } from './db.js';
import { id, token, hash, assert } from './util.js';
import { config } from './config.js';
export type User = { id: string; email: string; name: string; role: string; verified: boolean };
declare module 'express-serve-static-core' { interface Request { user?: User; vendor?: any; cartId?: string; tenant?: string; } }
export async function session(req: Request, _res: Response, next: NextFunction) {
  const value = req.cookies.sw_session;
  if (value) req.user = (await query<User>('SELECT u.id,u.email,u.name,u.role,u.verified FROM Sessions s JOIN Users u ON u.id=s.userId WHERE s.tokenHash=@hash AND s.expiresAt>SYSUTCDATETIME()', {hash:hash(value)}))[0];
  next();
}
export async function signIn(res: Response, userId: string) {
  const value=token(); await query('INSERT INTO Sessions(tokenHash,userId,csrf,expiresAt) VALUES(@hash,@user,@csrf,DATEADD(day,7,SYSUTCDATETIME()))',{hash:hash(value),user:userId,csrf:token()});
  res.cookie('sw_session',value,{httpOnly:true,secure:config.production,sameSite:'lax',maxAge:7*86400000,path:'/'});
}
export function authenticated(req: Request) { assert(req.user, 'Please sign in.',401); return req.user; }
export function admin(req: Request, roles=['host_admin']) { const user=authenticated(req); assert(roles.includes(user.role),'This action requires a permitted host role.',403); return user; }
export async function vendorScope(req: Request, write=false) {
  const user=authenticated(req);
  const vendor=(await query('SELECT v.*,m.role AS memberRole FROM Vendors v JOIN VendorMembers m ON m.vendorId=v.id WHERE m.userId=@user AND (@vendor IS NULL OR v.id=TRY_CONVERT(uniqueidentifier,@vendor))',{user:user.id,vendor:req.headers['x-vendor-id'] || null}))[0];
  assert(vendor,'You do not have access to this store.',403);
  if(write) assert(['owner','manager','catalog'].includes(vendor.memberRole),'Your store role cannot make this change.',403);
  return vendor;
}
export async function register(body: {email:string;name:string;password:string}, res:Response) {
  const userId=id(), value=token();
  await transaction(async tx=>{
    assert(!(await query('SELECT id FROM Users WHERE email=@email',{email:body.email.toLowerCase()},tx)).length,'This email is already registered.',409);
    await query('INSERT INTO Users(id,email,name,passwordHash) VALUES(@id,@email,@name,@password)',{id:userId,email:body.email.toLowerCase(),name:body.name,password:await bcrypt.hash(body.password,12)},tx);
    await query("INSERT INTO AccessTokens(id,tokenHash,purpose,email,resourceId,expiresAt) VALUES(@id,@hash,'verify_email',@email,@user,DATEADD(hour,24,SYSUTCDATETIME()))",{id:id(),hash:hash(value),email:body.email.toLowerCase(),user:userId},tx);
    await query("INSERT INTO OutboxMessages(id,type,source,data) VALUES(@id,'email',@source,@data)",{id:id(),source:`verify:${userId}`,data:{to:body.email,subject:'Verify your Shopwize email',text:`Verify your email: ${config.origin}/verify?token=${value}`}},tx);
  });
  await signIn(res,userId); return {ok:true, ...(config.demo ? {verificationLink:`/verify?token=${value}`} : {})};
}
export async function audit(actorId:string|null, action:string, resourceId:string, data:unknown={}, vendorId:string|null=null) { await query('INSERT INTO AuditEvents(id,actorId,vendorId,action,resourceId,data) VALUES(@id,@actorId,@vendorId,@action,@resourceId,@data)',{id:id(),actorId,vendorId,action,resourceId,data}); }
export async function getCart(req:Request,res:Response) {
  let cartId=req.cookies.sw_cart;
  if(!cartId || !(await query('SELECT id FROM Carts WHERE id=TRY_CONVERT(uniqueidentifier,@id)',{id:cartId})).length) {
    cartId=id();await query('INSERT INTO Carts(id,userId) VALUES(@id,@user)',{id:cartId,user:req.user?.id||null});
    res.cookie('sw_cart',cartId,{httpOnly:true,secure:config.production,sameSite:'lax',maxAge:30*86400000,path:'/'});
  }
  if(req.user)await query('UPDATE Carts SET userId=@user WHERE id=@id',{id:cartId,user:req.user.id});
  req.cartId=cartId;return cartId as string;
}

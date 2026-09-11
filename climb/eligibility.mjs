export const CITY_TYPE='0x308fa16c7aead43e3a49a4ff2e76205ba2a12697234f4fe80a2da66515284060::city::CITY';
export const CITY_STAKING_TYPE='0x008856d5d6d60a088f6153dbe6f7697d19f81d1d0403695c9e9fbaecdc8b29a9::city_staking::UserStake<'+CITY_TYPE+'>';
export const REQUIRED_CITY=5000000n*10n**9n;
const amount=value=>{if(!/^\d+$/.test(String(value)))throw Error('Invalid CITY balance response.');return BigInt(value);};
export async function fetchEligibility(rpc,address){
 if(!/^0x[0-9a-f]{64}$/i.test(address))throw Error('Invalid Sui wallet address.');
 const balance=await rpc('suix_getBalance',[address,CITY_TYPE]);
 const liquid=amount(balance?.totalBalance);let staked=0n,cursor=null;const cursors=new Set(),objects=new Set();
 do{
  const page=await rpc('suix_getOwnedObjects',[address,{filter:{StructType:CITY_STAKING_TYPE},options:{showContent:true}},cursor,50]);
  if(!Array.isArray(page?.data))throw Error('Unable to verify staked CITY.');
  for(const entry of page.data){const id=entry?.data?.objectId;if(!id||entry.error)throw Error('Unable to verify a staking position.');if(objects.has(id))continue;objects.add(id);staked+=amount(entry?.data?.content?.fields?.staked_amount);}
  if(!page.hasNextPage)break;
  if(!page.nextCursor||cursors.has(page.nextCursor))throw Error('Unable to finish staking verification.');
  cursor=page.nextCursor;cursors.add(cursor);
 }while(true);
 return {liquid,staked,total:liquid+staked,allowed:liquid+staked>=REQUIRED_CITY};
}
export const formatCity=value=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(Number(value/10n**9n));

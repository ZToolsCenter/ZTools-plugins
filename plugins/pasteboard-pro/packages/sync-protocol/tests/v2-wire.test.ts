import { describe, expect, it } from 'vitest';
import { encodeCanonicalV2, decodeCanonicalV2, encodeEnvelopeV2, parseUntrustedEnvelopeV2, validateHeaderV2, validateProjectionV2, validateIndexV2, validateHistoryKeyringV2, decodeBase64urlV2, validateObjectDescriptorV2, parseProjectionOrQuarantineV2, parseUntrustedBlobBodyV2, V2_MODEL, V2_SUITE } from '../src/v2';
const enc=new TextEncoder(), dec=new TextDecoder(), limit={maxBytes:8192};
const id='AAAAAAAAAAAAAAAAAAAAAA', b32='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const header={wireVersion:2 as const,suite:V2_SUITE,model:V2_MODEL,purpose:'object-seal' as const,accountBindingId:id,vaultId:id,keyEpoch:'0',revision:'0',objectType:'blob' as const,objectId:id,writerDomainId:b32,attemptId:b32,nonce:'AAAAAAAAAAAAAAAA',plaintextLength:'3'};
const limits={maxPlaintextBytes:100};
describe('V2 untrusted wire',()=>{
 it('canonicalizes integer-like names in UTF-16 lexical order',()=>{expect(dec.decode(encodeCanonicalV2({'2':'two','10':'ten'},limit))).toBe('{"10":"ten","2":"two"}');});
 it('uses ECMAScript numeric spelling and rejects unsupported values',()=>{expect(dec.decode(encodeCanonicalV2([1e30,-0,0.000001],limit))).toBe('[1e+30,0,0.000001]');for(const x of [NaN,Infinity,undefined,'\ud800',new Date(),[,1],Object.create({x:1})])expect(()=>encodeCanonicalV2(x,limit)).toThrow();});
 it('rejects duplicate, invalid UTF-8, noncanonical and unknown header',()=>{for(const x of ['{"a":1,"a":1}','{"b":1,"a":2}','{"a": 1}'])expect(()=>decodeCanonicalV2(enc.encode(x),limit)).toThrow();expect(()=>decodeCanonicalV2(Uint8Array.of(0xff),limit)).toThrow();expect(()=>validateHeaderV2({...header, extra:1},limits)).toThrow();});
 it('enforces depth/size bounds and rejects accessors and cycles',()=>{const x:{self?:unknown}={};x.self=x;expect(()=>encodeCanonicalV2(x,limit)).toThrow();expect(()=>encodeCanonicalV2({get x(){throw Error('should not run');}},limit)).toThrow();expect(()=>encodeCanonicalV2({x:'abcd'},{maxBytes:3})).toThrow();expect(()=>encodeCanonicalV2([[[0]]],{maxBytes:100,maxDepth:1})).toThrow();});
 it('rejects invalid U64 and noncanonical base64 trailing bits',()=>{for(const keyEpoch of ['01','18446744073709551616','-1']) expect(()=>validateHeaderV2({...header,keyEpoch},limits)).toThrow(); expect(()=>validateHeaderV2({...header,accountBindingId:'AAAAAAAAAAAAAAAAAAAAAB'},limits)).toThrow();expect(()=>validateHeaderV2({...header,accountBindingId:id+'=='},limits)).toThrow();});
 it('frames exact bytes and rejects truncation, trailing data and lower verified cap',()=>{const wire=encodeEnvelopeV2(header,Uint8Array.of(1,2,3),new Uint8Array(16),limits);const parsed=parseUntrustedEnvelopeV2(wire,limits);expect([...parsed.ciphertext]).toEqual([1,2,3]);expect(()=>parseUntrustedEnvelopeV2(wire.slice(0,-1),limits)).toThrow();expect(()=>parseUntrustedEnvelopeV2(Uint8Array.from([...wire,0]),limits)).toThrow();expect(()=>parseUntrustedEnvelopeV2(wire,{maxPlaintextBytes:2})).toThrow();});
 it('rejects wrapper mismatch before any KDF',()=>{expect(()=>validateHeaderV2({...header,objectType:'root-wrap',purpose:'password-wrap',plaintextLength:'32',wrapParams:{kind:'password',kdf:'scrypt',N:32768,r:8,p:1,dkLen:32,salt:b32}},limits)).toThrow();});
});
const hash='0'.repeat(64);const prov={relation:'undisclosed'};const row={representationHandle:id,portableCodecId:'text',codecVersion:'1',blobId:id,blobRevision:'0',sha256:hash,byteLength:1,provenance:prov};
const projection={bodyVersion:2,projectionId:id,sourceSnapshotId:id,sourceManifestRevision:id,sourceCursor:{hostEpoch:'epoch',changeSeq:'0'},originDeviceId:id,items:[{itemIndex:0,representations:[row]}],omissions:[],projectionDigest:hash};
describe('V2 structural body boundaries',()=>{
 it('rejects duplicate representations and disclosed fields in undisclosed provenance',()=>{expect(()=>validateProjectionV2({...projection,items:[{itemIndex:0,representations:[row,row]}]},8192)).toThrow();expect(()=>validateProjectionV2({...projection,items:[{itemIndex:0,representations:[{...row,provenance:{...prov,sourceAlias:id}}]}]},8192)).toThrow();});
 it('rejects reordered items and duplicate index identities',()=>{expect(()=>validateProjectionV2({...projection,items:[{itemIndex:1,representations:[]},{itemIndex:0,representations:[]}]},8192)).toThrow();const e={objectType:'projection',objectId:id,revision:'0',envelopeSha256:hash};expect(()=>validateIndexV2({bodyVersion:2,indexRevision:'0',entries:[e,e],sourceWatermarks:[]},8192)).toThrow();});
 it('rejects repeated and current history epochs',()=>{const v={keyringVersion:2,accountBindingId:id,vaultId:id,keyEpoch:'2',history:[{keyEpoch:'1',root:b32},{keyEpoch:'1',root:b32}]};expect(()=>validateHistoryKeyringV2(v)).toThrow();expect(()=>validateHistoryKeyringV2({...v,history:[{keyEpoch:'2',root:b32}]})).toThrow();});
});

describe('independent structural counterexamples',()=>{
 it('rejects duplicate source watermarks and malformed unknown field',()=>{const w={originDeviceId:id,approvedHostEpoch:'e',sourceSnapshotId:id,changeSeq:'0',deleted:true};expect(()=>validateIndexV2({bodyVersion:2,indexRevision:'0',entries:[],sourceWatermarks:[w,w]},8192)).toThrow();expect(()=>validateIndexV2({bodyVersion:2,indexRevision:'0',entries:[],sourceWatermarks:[],future:true},8192)).toThrow();});
 it('refuses an oversized claimed blob before allocating the body',()=>{expect(()=>validateHeaderV2({...header,plaintextLength:'209715201'},{maxPlaintextBytes:200*1024*1024})).toThrow();});
});

it('reports unsupported index versions even when future fields are present',()=>{
  try { validateIndexV2({bodyVersion:3,indexRevision:'0',entries:[],sourceWatermarks:[],future:true},8192); throw new Error('expected rejection'); }
  catch (error) { expect((error as {code?:string}).code).toBe('unsupported-version'); }
});

it('returns a frozen independent JSON snapshot instead of caller-owned references',()=>{
  const input={...projection,items:[{itemIndex:0,representations:[{...row,provenance:{...prov}}]}]};
  const result=validateProjectionV2(input,8192);
  input.items[0]!.representations[0]!.blobId='BBBBBBBBBBBBBBBBBBBBBA';
  expect(result.items[0]!.representations[0]!.blobId).toBe(id);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.items[0]!.representations[0]!.provenance)).toBe(true);
  const h=validateHeaderV2(header,limits);
  expect(Object.isFrozen(h)).toBe(true);
});

it('copies Buffer-backed envelope outputs rather than exposing Buffer slice aliases',()=>{
  const original=Buffer.from(encodeEnvelopeV2(header,Uint8Array.of(1,2,3),new Uint8Array(16),limits));
  const parsed=parseUntrustedEnvelopeV2(original,limits);
  original.fill(0);
  expect([...parsed.ciphertext]).toEqual([1,2,3]);
  expect([...parsed.aad.slice(0,4)]).toEqual([80,66,86,50]);
});


describe('untrusted ownership and budget boundaries',()=>{
 it('never invokes a future body version accessor and rejects shared ciphertext',()=>{
  let reads=0;const future={get bodyVersion(){reads++;return 3;}};
  expect(()=>parseProjectionOrQuarantineV2(future,Uint8Array.of(1),8192)).toThrow();
  expect(reads).toBe(0);
  expect(()=>parseProjectionOrQuarantineV2({bodyVersion:3},new Uint8Array(new SharedArrayBuffer(1)),8192)).toThrow();
 });
 it('validates the same immutable descriptor snapshot returned to the caller',()=>{
  const source={objectType:'not-a-valid-type',objectId:id,revision:'0',envelopeSha256:hash};
  const proxy=new Proxy(source,{get(target,key,receiver){return key==='objectType'?'projection':Reflect.get(target,key,receiver);}});
  expect(()=>validateObjectDescriptorV2(proxy)).toThrow();
 });
 it('rejects nonfinite and out-of-range budgets before copying blob or quarantine bytes',()=>{
  const meta=encodeCanonicalV2({bodyVersion:2,blobId:id,blobRevision:'0',byteLength:1,sha256:hash,portableCodecId:'text',codecVersion:'1'},limit);
  const body=new Uint8Array(4+meta.length+1);new DataView(body.buffer).setUint32(0,meta.length,false);body.set(meta,4);
  for(const cap of [NaN,Infinity,-1,0,200*1024*1024+1]) {
   expect(()=>parseUntrustedBlobBodyV2(body,cap)).toThrow();
   expect(()=>parseProjectionOrQuarantineV2({bodyVersion:3},Uint8Array.of(1),cap)).toThrow();
  }
 });
});


it('validates base64 byte caps before decoding while allowing empty bytes under a positive cap',()=>{
 for(const cap of [NaN,Infinity,-1,0,200*1024*1024+1]) expect(()=>decodeBase64urlV2('AA',undefined,cap)).toThrow();
 expect([...decodeBase64urlV2('',0,1)]).toEqual([]);
});

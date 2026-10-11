#!/usr/bin/env python3
"""Re-check after CSV regeneration. Uses cached per-round records (res_<mode>.pkl) from the first audit."""
import sys, io, re, pickle, hashlib, math, time
from fractions import Fraction as F
import zstandard
D='/home/claude/origami-slot/math/stake/'; OUT='/home/claude/origami-slot/.work/audit/'
mode=sys.argv[1]; cost={'base':F(1),'ante':F(5,4),'bonus':F(100),'super':F(300)}[mode]
rec=pickle.load(open(OUT+f'res_{mode}.pkl','rb'))['records']
# ---- (b) CSV format
data=open(D+f'lookUpTable_{mode}_0.csv','rb').read()
print('==',mode,'csv bytes',len(data),'ends with newline',data.endswith(b'\n'),'CR',b'\r' in data,'BOM',data[:3]==b'\xef\xbb\xbf')
lines=data.decode('ascii').split('\n')
if lines[-1]=='': lines=lines[:-1]
pat=re.compile(r'^(0|[1-9][0-9]*),(0|[1-9][0-9]*),(0|[1-9][0-9]*)$')
bad=0; ids_ok=True; nw=[]; npay=[]
for i,l in enumerate(lines):
    mm=pat.match(l)
    if not mm: bad+=1; nw.append(0); npay.append(-1); continue
    a,w,p=int(mm.group(1)),int(mm.group(2)),int(mm.group(3))
    if a!=i+1: ids_ok=False
    nw.append(w); npay.append(p)
N=len(lines)
W=sum(nw); WP=sum(w*p for w,p in zip(nw,npay))
print(' rows',N,'cached rounds',len(rec),'bad rows',bad,'ids sequential',ids_ok,'zero weights',sum(1 for w in nw if w==0),'weights>=2^64',sum(1 for w in nw if w>=2**64),
      'payout not mult of 10',sum(1 for p in npay if p%10),'0<payout<10',sum(1 for p in npay if 0<p<10),'payout>cap',sum(1 for p in npay if p>1500000))
print(' min weight',min(nw),'max weight',max(nw),'distinct weights',len(set(nw)),'sum weights',W,'bits',W.bit_length(),'<2^64',W<2**64)
print(' sum(weight*payout)',WP,'bits',WP.bit_length(),'fits int64 (<2^63):',WP<2**63,'headroom factor',float(F(2**63,WP)))
print(' max single weight*payout',max(w*p for w,p in zip(nw,npay)))
# ---- (a) payout column vs cached book payouts (first audit) and vs old csv payouts
old_w=[x[2] for x in rec]; book_p=[x[1] for x in rec]
print(' payout column == cached book payoutMultiplier (first audit) line by line:', npay==book_p, 'mismatches',sum(1 for a,b in zip(npay,book_p) if a!=b))
# ---- (a) re-stream books: per-line id, payoutMultiplier, events hash vs cache, and vs new CSV
t0=time.time()
rd=io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(open(D+f'books_{mode}.jsonl.zst','rb')),encoding='utf-8',newline='\n')
hd=re.compile(r'^\{"id":(\d+),"payoutMultiplier":(\d+),"events":')
n=0; mism_hash=0; mism_pm_csv=0; mism_pm_cache=0; mism_id=0; rawbytes=0; badhead=0; ex=[]
whole=hashlib.sha256()
for line in rd:
    n+=1; rawbytes+=len(line); whole.update(line.encode())
    m=hd.match(line)
    if not m: badhead+=1; continue
    rid=int(m.group(1)); pm=int(m.group(2))
    if rid!=n: mism_id+=1
    if n>N or pm!=npay[n-1]:
        mism_pm_csv+=1
        if len(ex)<5: ex.append(n)
    if n<=len(rec):
        r=rec[n-1]
        if pm!=r[1]: mism_pm_cache+=1
        evraw=line.rstrip('\n')[m.end():-1]
        if hashlib.blake2b(evraw.encode(),digest_size=12).digest()!=r[12]: mism_hash+=1
print(' books re-streamed: lines',n,'decompressed chars',rawbytes,'bad line heads',badhead,'id mismatches',mism_id,
      '| payoutMultiplier vs NEW csv mismatches',mism_pm_csv,ex,'| vs cached payout mismatches',mism_pm_cache,'| events-hash vs cache mismatches',mism_hash,
      '| line count == csv rows',n==N,'| sha256(decompressed)',whole.hexdigest()[:16], 'time',round(time.time()-t0,1))
# ---- (c) exact stats with new weights and cached book-derived flags
def binom(q,k): return math.comb(5,k)*q**k*(1-q)**(5-k)
q=0.083253 if mode=='ante' else 0.065131
def stats(ws,label):
    W=sum(ws); WP=sum(w*x[1] for w,x in zip(ws,rec))
    rtp=F(WP,W)/100/cost
    zero=F(sum(w for w,x in zip(ws,rec) if x[1]==0),W)
    wt=sum(w for w,x in zip(ws,rec) if x[4]); trig=F(wt,W)
    split=[F(sum(w for w,x in zip(ws,rec) if x[4] and x[3]==k),wt) for k in (3,4,5)]
    pmax=F(sum(w for w,x in zip(ws,rec) if x[1]==1500000),W)
    means=[]
    for k in (3,4,5):
        wk=sum(w for w,x in zip(ws,rec) if x[4] and x[3]==k)
        means.append(float(F(sum(w*x[1] for w,x in zip(ws,rec) if x[4] and x[3]==k),wk))/100)
    print(f' [{label}] RTP={float(rtp):.13f} exact={rtp} zero={float(zero):.10f} P(trig)={float(trig):.12g} split={[round(float(s),6) for s in split]} Pmax={float(pmax):.8e} (1 in {float(1/pmax):.2f}) n_max={sum(1 for x in rec if x[1]==1500000)} mean pay by scat 3/4/5={[round(v,3) for v in means]}')
    return rtp,zero,trig,split,pmax
new=stats(nw,'NEW'); old=stats(old_w,'OLD')
pb=sum(binom(q,k) for k in (3,4,5))
print(' binomial: P(3+)=',pb,'cond split',[round(binom(q,k)/pb,6) for k in (3,4,5)], 'data/binom trig ratio (new)',float(new[2])/pb if mode in('base','ante') else 'n/a')
print(' deltas new-old: RTP %.3e zero %.3e trig %.3e Pmax(rel) %.3e split %s'%(float(new[0]-old[0]),float(new[1]-old[1]),float(new[2]-old[2]),float(new[4]/old[4]-1),[ '%.2e'%float(a-b) for a,b in zip(new[3],old[3])]))
# ---- (e) weight movement vs old/100
maxrel=0; maxabs=F(0); worst=None; nround=0; nfloor=0; nceil=0; nother=0; ex2=[]
for i,(w,o) in enumerate(zip(nw,old_w)):
    t=F(o,100); d=abs(F(w)-t); rel=float(d/t)
    if rel>maxrel: maxrel=rel; worst=(i+1,o,w)
    if d>maxabs: maxabs=d
    if w==(o+50)//100 or w==(2*o+100)//200: nround+=1   # round half up
    elif w==o//100: nfloor+=1
    elif w==-(-o//100): nceil+=1
    else:
        nother+=1
        if len(ex2)<5: ex2.append((i+1,o,w))
print(' weight vs old/100: max |new-old/100|=',float(maxabs),'max relative deviation=%.3e'%maxrel,'worst (id,old,new)',worst)
print('   equals round-half-up(old/100):',nround,'| floor only:',nfloor,'| ceil only:',nceil,'| moved by more than rounding (>=1 unit):',nother,ex2)
print('   sum new / (sum old/100) - 1 = %.3e'%(float(F(sum(nw)*100,sum(old_w)))-1))
# is weight still a function of (trig,scat,payout)?
d={}
viol=0
for w,x in zip(nw,rec):
    key=(x[4],x[3] if x[4] else -1,x[1])
    if d.setdefault(key,w)!=w: viol+=1
print('   weight still a function of (trigger,scatters,payout): violations',viol)

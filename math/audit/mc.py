#!/usr/bin/env python3
"""Independent Monte Carlo of the game using parameters estimated from the (weighted) book data."""
import sys, pickle, math, time
import numpy as np
OUT='/home/claude/origami-slot/.work/audit/'
syms=['L1','L2','L3','L4','H4','H3','H2','H1']
PAYT=np.zeros((10,6),dtype=np.int64)
pt={'L1':(20,60,250),'L2':(20,60,250),'L3':(30,100,400),'L4':(30,100,400),'H4':(60,200,800),'H3':(100,400,1500),'H2':(200,800,4000),'H1':(500,2500,15000)}
for i,s in enumerate(syms): PAYT[i,3:6]=pt[s]
CAP=1500000
R={m:pickle.load(open(OUT+f'res_{m}.pkl','rb')) for m in ['base','bonus']}
def pdist(d):
    v=np.array([sum(d.get((r,s),0) for r in range(5)) for s in syms],dtype=float); return v/v.sum()
P_BASE=pdist(R['base']['base_sym_w']); P_FS=pdist(R['bonus']['fs_new_w'])
print('P_BASE',np.round(P_BASE,5)); print('P_FS  ',np.round(P_FS,5))
del R
M_BASE=(np.array([2,3,5]),np.array([0.70,0.25,0.05]))
M_FS=(np.array([2,3,5,10]),np.array([0.50,0.30,0.15,0.05]))
def draw(rng,vals,p,shape):
    return vals[np.searchsorted(np.cumsum(p),rng.random(shape),side='right').clip(0,len(vals)-1)]
def drawsym(rng,P,shape):
    return np.searchsorted(np.cumsum(P),rng.random(shape),side='right').clip(0,7).astype(np.int8)
def evalb(sym,wm):
    first=sym[:,0,:].astype(np.int64)
    run=np.ones(first.shape,dtype=bool); cnt=np.ones(first.shape,dtype=np.int64); mult=np.ones(first.shape,dtype=np.int64)
    for r in range(1,5):
        c=sym[:,r,:]
        run&=(c==first)|(c==8)
        cnt+=run
        mult*=np.where(run,wm[:,r,:],1)
    win=PAYT[first,cnt]*mult
    return win.sum(axis=1)
def base_board(rng,n,q,pw,force_k=None):
    sym=drawsym(rng,P_BASE,(n,5,5)); wm=np.ones((n,5,5),dtype=np.int64)
    if force_k is None:
        has=rng.random((n,5))<q
    else:
        has=np.argsort(rng.random((n,5)),axis=1)<force_k
    srow=rng.integers(0,5,size=(n,5))
    S=has[:,:,None]&(np.arange(5)[None,None,:]==srow[:,:,None])
    w=(rng.random((n,3,5))<pw)&~S[:,1:4,:]
    m=draw(rng,*M_BASE,(n,3,5))
    sym[:,1:4,:]=np.where(w,8,sym[:,1:4,:]); wm[:,1:4,:]=np.where(w,m,1)
    sym=np.where(S,9,sym)
    return evalb(sym,wm), has.sum(axis=1)
def sim_fs(rng,N,k,pw,qf,sup,pw_base=0.09855):
    FS={3:8,4:10,5:12}[k]
    total,_=base_board(rng,N,0,pw_base,force_k=k)
    basewin=total.copy()
    left=np.full(N,FS); awarded=np.full(N,FS); played=np.zeros(N,dtype=np.int64); nret=np.zeros(N,dtype=np.int64)
    sticky=np.zeros((N,3,5),dtype=np.int64)
    if sup:
        for r in range(3):
            sticky[np.arange(N),r,rng.integers(0,5,size=N)]=draw(rng,*M_FS,N)
    active=total<CAP
    total=np.minimum(total,CAP)
    while active.any():
        idx=np.nonzero(active)[0]; n=len(idx)
        sym=drawsym(rng,P_FS,(n,5,5)); wm=np.ones((n,5,5),dtype=np.int64)
        st=sticky[idx]
        has=rng.random((n,5))<qf; srow=rng.integers(0,5,size=(n,5))
        S=has[:,:,None]&(np.arange(5)[None,None,:]==srow[:,:,None])
        S[:,1:4,:]&=(st==0)
        neww=(rng.random((n,3,5))<pw)&(st==0)&~S[:,1:4,:]
        st=np.where(neww,draw(rng,*M_FS,(n,3,5)),st)
        sym[:,1:4,:]=np.where(st>0,8,sym[:,1:4,:]); wm[:,1:4,:]=np.where(st>0,st,1)
        sym=np.where(S,9,sym)
        win=evalb(sym,wm)
        t=total[idx]+win; capped=t>=CAP; total[idx]=np.minimum(t,CAP)
        sticky[idx]=st
        played[idx]+=1
        nsc=S.sum(axis=(1,2)); add=np.where((nsc>=3)&~capped,np.minimum(5,40-awarded[idx]),0)
        nret[idx]+=(nsc>=3)&~capped&(add>0)
        awarded[idx]+=add; left[idx]+=add-1
        active[idx]=(left[idx]>0)&~capped
    return total,basewin,played,nret,(sticky>0).sum(axis=(1,2))
def report(name,res):
    total,basewin,played,nret,nst=res; N=len(total); x=total/100
    print(f'{name}: N={N} mean={x.mean():.3f}x se={x.std()/math.sqrt(N):.3f} sd={x.std():.1f} fs_part={(total-basewin).mean()/100:.3f} basewin={basewin.mean()/100:.4f} >100x={np.mean(total>10000):.5f} >1000x={np.mean(total>100000):.6f} Pmax={np.mean(total==CAP):.3e} (n={np.sum(total==CAP)}) zero={np.mean(total==0):.5f} spins={played.mean():.3f} retrig={nret.mean():.4f} stickyEnd={nst.mean():.3f}',flush=True)
    np.save(OUT+'mc_tot_'+name.replace(' ','_').replace('=','')+'.npy',total.astype(np.int32))
    return x.mean(), x.std()/math.sqrt(N)
if __name__=='__main__':
    what=sys.argv[1]; seed=int(sys.argv[2]); N=int(sys.argv[3])
    rng=np.random.default_rng(seed)
    CH=250000
    def run(k,pw,qf,sup,N):
        parts=[sim_fs(rng,min(CH,N-i),k,pw,qf,sup) for i in range(0,N,CH)]
        return tuple(np.concatenate([p[j] for p in parts]) for j in range(5))
    if what=='bonus':
        pw=float(sys.argv[4]); qf=float(sys.argv[5])
        for k,n in ((3,N),(4,N//4),(5,N//8)):
            report(f'bonus k={k} pw={pw} qf={qf}',run(k,pw,qf,False,n))
    elif what=='super':
        pw=float(sys.argv[4]); qf=float(sys.argv[5])
        for k,n in ((3,N),(4,N//4),(5,N//8)):
            report(f'super k={k} pw={pw} qf={qf}',run(k,pw,qf,True,n))
    elif what=='base':
        q=float(sys.argv[4]); pw=float(sys.argv[5])
        edges=[0,1,200,1000,5000,10**9]
        hist=np.zeros(len(edges)-1); tot=0; sw=0.0; nk=np.zeros(6); cnt_big=0; sw2=0.0; trigwin=0.0
        from collections import Counter
        payc=Counter()
        for i in range(0,N,CH*4):
            n=min(CH*4,N-i)
            win,k=base_board(rng,n,q,pw)
            nt=k<3
            hist+=np.histogram(win[nt],bins=edges)[0]; tot+=n; sw+=win[nt].sum(); sw2+=(win[nt].astype(float)**2).sum(); nk+=np.bincount(k,minlength=6); trigwin+=win[~nt].sum()
            u,c=np.unique(win[nt],return_counts=True)
            for a,b in zip(u,c): payc[int(a)]+=int(b)
        nnt=hist.sum()
        print(f'base MC q={q} pw={pw} N={tot}: P(trig)={1-nnt/tot:.6f} nontrig mean={sw/nnt/100:.5f}x se={math.sqrt(sw2/nnt-(sw/nnt)**2)/math.sqrt(nnt)/100:.5f} zero_cond={hist[0]/nnt:.5f} strata shares (of all rounds) {[round(h/tot,6) for h in hist]} scat dist {np.round(nk/tot,6)} trig basewin mean={trigwin/max(1,tot-nnt)/100:.4f}')
        pickle.dump(dict(payc=payc,tot=tot,nnt=nnt),open(OUT+f'mc_base_{q}_{seed}.pkl','wb'))

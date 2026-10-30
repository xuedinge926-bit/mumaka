import { useId, useState } from 'react';

interface StarRatingProps {
  label: string;
  value: number | null | 'na';
  onChange: (value: number | null) => void;
  disabled?: boolean;
}

/** Five physical stars; each star offers its left half and right half as one target. */
export function StarRating({label,value,onChange,disabled=false}:StarRatingProps) {
  const [hover,setHover]=useState<number|null>(null);
  const id=useId().replace(/:/g,'');
  const amount=hover??(typeof value==='number'?value:0);
  const fromPointer=(event:React.MouseEvent<HTMLButtonElement>|React.PointerEvent<HTMLButtonElement>,star:number)=>{
    const bounds=event.currentTarget.getBoundingClientRect();
    return star-(event.clientX-bounds.left<bounds.width/2?.5:0);
  };
  return <div className={`star-rating five-stars ${disabled?'is-disabled':''}`} role="slider" tabIndex={disabled?-1:0}
    aria-label={`${label}评分`} aria-valuemin={.5} aria-valuemax={5}
    aria-valuenow={typeof value==='number'?value:undefined}
    aria-valuetext={value===null?'未评分':value==='na'?'不适用':`${value} 星`}
    aria-disabled={disabled} onPointerLeave={()=>setHover(null)}
    onKeyDown={event=>{
      if(disabled)return;
      const current=typeof value==='number'?value:0;
      if(['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','Home','End','Delete','Backspace'].includes(event.key))event.preventDefault();
      if(event.key==='ArrowLeft'||event.key==='ArrowDown')onChange(Math.max(.5,current-.5));
      if(event.key==='ArrowRight'||event.key==='ArrowUp')onChange(Math.min(5,current+.5));
      if(event.key==='Home')onChange(.5);
      if(event.key==='End')onChange(5);
      if(event.key==='Delete'||event.key==='Backspace')onChange(null);
    }}>
    {[1,2,3,4,5].map(star=>{
      const fill=Math.max(0,Math.min(1,amount-star+1))*100;
      return <button type="button" key={star} tabIndex={-1} disabled={disabled}
        aria-label={`${label} 第${star}颗星`}
        onPointerMove={event=>{if(event.pointerType==='mouse'&&!disabled)setHover(fromPointer(event,star));}}
        onClick={event=>{if(!disabled){onChange(event.detail===0?star:fromPointer(event,star));setHover(null);}}}>
        <svg viewBox="0 0 40 40" aria-hidden="true"><defs><clipPath id={`${id}-${star}`}><rect width={40*fill/100} height="40"/></clipPath></defs><path d="m20 3 5.1 10.4L36.6 15l-8.3 8.1 2 11.5L20 29.2 9.7 34.6l2-11.5L3.4 15l11.5-1.6Z" className="star-empty"/><path d="m20 3 5.1 10.4L36.6 15l-8.3 8.1 2 11.5L20 29.2 9.7 34.6l2-11.5L3.4 15l11.5-1.6Z" clipPath={`url(#${id}-${star})`} className="star-filled"/></svg>
      </button>;
    })}
  </div>;
}
export default StarRating;

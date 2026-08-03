import{e as o}from"./vendor-react-bqabn7da.js";function n(e,t=350){const[r,s]=o.useState(e);return o.useEffect(()=>{const u=setTimeout(()=>s(e),t);return()=>clearTimeout(u)},[e,t]),r}export{n as u};

import type {
  GenerateIkebanaReq,
  GenerateRenderReq,
  InpaintRenderReq,
  PosterImagesReq,
  PosterImagesRes,
  PosterTextReq,
  PosterTextRes,
  SvgRes,
} from './shared/api';

async function post<Req, Res>(url: string, body: Req): Promise<Res> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({ error: `Model server unreachable or failed (HTTP ${r.status}). Is \`npm run server\` running?` }));
  if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
  return json as Res;
}

export const api = {
  generateRender: (b: GenerateRenderReq) => post<GenerateRenderReq, SvgRes>('/api/model_1/generate-render', b),
  inpaintRender: (b: InpaintRenderReq) => post<InpaintRenderReq, SvgRes>('/api/model_1/inpaint-render', b),
  generateIkebana: (b: GenerateIkebanaReq) => post<GenerateIkebanaReq, SvgRes>('/api/model_1/generate-ikebana', b),
  generatePosterText: (b: PosterTextReq) => post<PosterTextReq, PosterTextRes>('/api/model_2/generate-poster-text', b),
  generatePosterImages: (b: PosterImagesReq) => post<PosterImagesReq, PosterImagesRes>('/api/model_1/generate-poster-images', b),
};

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

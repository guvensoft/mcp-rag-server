import fs from 'fs';
import path from 'path';

export interface Weights { semantic: number; lexical: number; graph: number; reranker: number; }
const defaultWeights: Weights = { semantic: 0.6, lexical: 0.25, graph: 0.1, reranker: 0.05 };

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

export class WeightManager {
  private file: string;
  private w: Weights;
  constructor(file = path.join(process.cwd(), 'weights.json')) {
    this.file = file;
    this.w = this.load();
  }
  private load(): Weights {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const merged: Weights = {
        ...defaultWeights,
        semantic: data.semantic ?? defaultWeights.semantic,
        lexical: data.lexical ?? defaultWeights.lexical,
        graph: data.graph ?? defaultWeights.graph,
        reranker: data.reranker ?? defaultWeights.reranker,
      };
      return merged;
    } catch { return { ...defaultWeights }; }
  }
  private save() { fs.writeFileSync(this.file, JSON.stringify(this.w, null, 2), 'utf8'); }
  get(): Weights { return { ...this.w }; }
  feedback(kind: 'up' | 'down') {
    const delta = kind === 'up' ? 0.01 : -0.01;
    // simple strategy: increase semantic on up, lexical on down toggles towards balance
    this.w.semantic = clamp01(this.w.semantic + delta);
    this.w.lexical = clamp01(this.w.lexical + (kind === 'up' ? -delta/2 : +delta/2));
    // normalize
    const s = this.w.semantic + this.w.lexical + this.w.graph + this.w.reranker;
    this.w.semantic /= s; this.w.lexical /= s; this.w.graph /= s; this.w.reranker /= s;
    this.save();
  }
}


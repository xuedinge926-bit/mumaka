import { ArrowRight } from "lucide-react";
import { AnchorReference } from "./AnchorReference";
import type { Preferences } from "../lib/preferences";

export function Home({
  busy,
  onScore,
  onReference,
  preferences,
}: {
  busy: boolean;
  onScore: () => void;
  onReference: () => void;
  preferences: Preferences;
}) {
  return (
    <main className="simple-home">
      <section className="home-intro">
        <p className="home-kicker">听见作品，留下判断。</p>
        <h1>
          让每一次聆听
          <br />
          有自己的刻度。
        </h1>
        <p>从一张专辑开始，在六个维度里记录你的感受。</p>
        <button
          className="button primary home-score"
          disabled={busy}
          onClick={onScore}
        >
          快速评分
          <ArrowRight size={18} />
        </button>
        <span className="home-manual-note">手动添加专辑资料</span>
      </section>
      <AnchorReference
        compact
        expanded={preferences.referenceExpanded}
        onFull={onReference}
      />
    </main>
  );
}

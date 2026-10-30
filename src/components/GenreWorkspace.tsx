import { useState } from "react";
import { genres } from "../model/engine";
import { GenrePicker, FAMILY_NAMES } from "./GenrePicker";
import type { Album } from "../model/types";

export function GenreWorkspace({
  album,
  canApply,
  onApply,
  onNew,
}: {
  album: Album | null;
  canApply: boolean;
  onApply: (id: string) => void;
  onNew: (id: string) => void;
}) {
  const [selected, setSelected] = useState(album?.genreId ?? "");
  const genre = genres.find((g) => g.id === selected);
  return (
    <main className="workspace-page genre-workspace">
      <header className="workbench-heading">
        <div>
          <p>MUMAKA / 木马卡</p>
          <h1>风格管理</h1>
        </div>
        <span className="read-only-note">风格库只读</span>
      </header>
      <section className="genre-library">
        <p>查找并选择现有风格。中国与其他地区使用同一套分类。</p>
        <GenrePicker
          label="风格库"
          value={selected}
          market={album?.ux?.market ?? "china"}
          onChange={(id) => setSelected(id)}
        />
        {genre && (
          <div className="genre-library-selection">
            <small>{FAMILY_NAMES[genre.parentId ?? ""] ?? ""}</small>
            <h2>{genre.name}</h2>
            <p>{genre.nameEn}</p>
            <div className="genre-library-actions">
              {album && canApply && (
                <button
                  className="button primary"
                  onClick={() => onApply(genre.id)}
                >
                  应用到当前草稿
                </button>
              )}
              <button
                className="button secondary"
                onClick={() => onNew(genre.id)}
              >
                用此风格创建评分
              </button>
            </div>
            {album && canApply && (
              <p className="subtle-hint">
                当前草稿：{album.title || "未命名专辑"}。应用后将返回资料确认。
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

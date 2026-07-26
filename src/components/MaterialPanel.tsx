import { materialCatalogByGroup, type PackagingProject } from "@packcad/format";

interface MaterialPanelProps {
  project: PackagingProject;
  onSelect: (specId: string) => void;
}

export function MaterialPanel({ project, onSelect }: MaterialPanelProps) {
  const groups = materialCatalogByGroup();
  const swatchColor = {
    chipboard: "#c8b394",
    corrugated: "#b98f5a",
    flute: "#d0a66b",
    kraft: "#bc8d55",
  } as const;
  return (
    <section className="panel material-panel">
      <div className="panel-heading">Material</div>
      {(["paperboard", "corrugated"] as const).map((group) => (
        <div className="material-group" key={group}>
          <span>{group}</span>
          {groups[group].map((spec) => (
            <button
              type="button"
              className={project.materialSpec === spec.id ? "material-row selected" : "material-row"}
              onClick={() => onSelect(spec.id)}
              key={spec.id}
            >
              <i style={{ background: swatchColor[spec.swatch] }} />
              <span>{spec.label}</span>
              <small>{(spec.thicknessIn * 25.4).toFixed(2)} mm</small>
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}

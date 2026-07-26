import type { PackagingProject } from "@packcad/format";

interface OperationPipelinePanelProps {
  project: PackagingProject;
  onToggleOperation: (operationId: string) => void;
}

export function OperationPipelinePanel({
  project,
  onToggleOperation,
}: OperationPipelinePanelProps) {
  return (
    <section className="panel operation-panel">
      <div className="panel-heading">Operation pipeline</div>
      <ol>
        {(project.design?.operations ?? []).map((operation, index) => (
          <li className={operation.enabled ? "" : "disabled"} key={operation.id}>
            <span className="operation-index">{String(index + 1).padStart(2, "0")}</span>
            <span>
              <strong>{operation.name || operation.type.replaceAll("_", " ")}</strong>
              <small>{operation.type.replace("OPERATION_", "").replaceAll("_", " ")}</small>
            </span>
            <button
              type="button"
              aria-label={`${operation.enabled ? "Disable" : "Enable"} ${operation.name}`}
              onClick={() => onToggleOperation(operation.id)}
            >
              {operation.enabled ? "●" : "○"}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

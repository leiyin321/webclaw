import {
  completeTaskRun,
  completeTask,
  failTask,
  pushTask,
  recordTaskModelStep,
  taskStackSnapshot
} from "./task-stack.js";

export function createAgentTaskSupervisor(run, options = {}) {
  if (!run?.id) throw new Error("TaskSupervisor requires a task run.");
  const persist = typeof options.persist === "function" ? options.persist : async () => {};
  const onTransition = typeof options.onTransition === "function" ? options.onTransition : () => {};

  const commit = async (type, task, extra = {}) => {
    await persist(run);
    const transition = {
      type,
      taskRunId: run.id,
      taskId: String(task?.id || extra.taskId || ""),
      parentTaskId: String(task?.parentId || extra.parentTaskId || ""),
      status: String(task?.status || run.status || ""),
      timestamp: Date.now(),
      snapshot: taskStackSnapshot(run),
      ...extra
    };
    onTransition(transition);
    return transition;
  };

  return {
    run,
    snapshot() { return taskStackSnapshot(run); },

    async push(parentTaskId, spec) {
      const task = pushTask(run, parentTaskId, spec);
      await commit("task_pushed", task);
      return task;
    },

    async recordModelStep(taskId, stepOptions = {}) {
      recordTaskModelStep(run, taskId, stepOptions);
      const task = taskId ? run.tasks[taskId] : null;
      const frame = task || run.runFrame;
      await commit(task ? "task_model_step" : "agent_run_model_step", task, {
        step: Number(frame?.step || 0)
      });
      return frame;
    },

    async complete(taskId, output = undefined) {
      const task = completeTask(run, taskId);
      await commit("task_completed", task, { output });
      return task;
    },

    async fail(taskId, error = "") {
      const task = failTask(run, taskId);
      await commit("task_failed", task, { error: String(error || "") });
      return task;
    },

    async completeRun(status = "completed", summary = {}) {
      completeTaskRun(run, status);
      await commit("task_run_completed", null, { status, summary });
    }
  };
}

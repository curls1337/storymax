// Shared in-memory task state + DB persistence (single instance across modules).
const activeTasks = {};

async function saveTaskState(db, storyboardId, taskState) {
  try {
    await db.run(
      'UPDATE storyboards SET active_task_data = ? WHERE id = ?',
      [JSON.stringify(taskState), storyboardId]
    );
  } catch (err) {
    console.error('Failed to save task state to DB:', err);
  }
}

module.exports = { activeTasks, saveTaskState };

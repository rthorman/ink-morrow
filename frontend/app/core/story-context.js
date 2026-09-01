// Resolve and activate one manuscript for any story-scoped workspace room.
// The backend retains its historical "story" identifiers; the shell exposes
// one shared manuscript selector and every room consumes the same state.

export async function chooseWorkspaceStory({ storyId, state, features }) {
  let story = state.data.currentStory?.id === storyId
    ? state.data.currentStory
    : state.data.stories.find((entry) => entry.id === storyId);
  if (!story) {
    await features.stories.loadStories();
    story = state.data.stories.find((entry) => entry.id === storyId);
  }
  if (!story) return null;
  if (state.data.currentStory?.id !== story.id) {
    features.write.resetStoryReader();
    state.data.currentStory = story;
    state.resetStoryCost();
    features.write.updateStorySelect();
  }
  return story;
}

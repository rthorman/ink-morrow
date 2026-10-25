import { jest } from '@jest/globals';
import { createPrivateDraft } from '../app/fiction/private-drafts.js';
const scope = { type: 'setup', id: 'new-story' };
const saved = () => ({ id: 'draft', scope, revision: 2, content: { title: 'Saved title' }, submitted: null });
describe('authenticated private draft lifecycle', () => {
  beforeEach(() =>
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'client-draft' })
  );
  afterEach(() => jest.useRealTimers());
  test('reload recovers an acknowledged version; writes carry its exact revision', async () => {
    const api = jest.fn(async (path, method, body) =>
      method === 'PATCH' ? { draft: { ...saved(), revision: 3, content: body.content } } : { draft: saved() }
    );
    const controller = createPrivateDraft({ api });
    expect(await controller.open(scope, {})).toEqual({ title: 'Saved title' });
    controller.edit({ title: 'New title' });
    await controller.flush();
    expect(api).toHaveBeenLastCalledWith('/fiction/drafts/draft', 'PATCH', {
      expected_revision: 2,
      content: { title: 'New title' }
    });
    expect(controller.state.dirty).toBe(false);
    controller.close();
  });
  test('a late acknowledgement cannot erase a newer local edit', async () => {
    let finish;
    const api = jest.fn((path, method) =>
      method === 'PATCH'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ draft: saved() })
    );
    const controller = createPrivateDraft({ api });
    await controller.open(scope, {});
    controller.edit({ title: 'First edit' });
    const pending = controller.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.edit({ title: 'Newer edit' });
    finish({ draft: { ...saved(), revision: 3, content: { title: 'First edit' } } });
    await pending;
    expect(controller.state.local.title).toBe('Newer edit');
    expect(controller.state.dirty).toBe(true);
    controller.close();
  });
  test('two tabs require comparison before either saved version is replaced', async () => {
    const server = { ...saved(), revision: 4, content: { title: 'Other tab' } };
    let opening = true;
    const api = jest.fn(async (path, method) => {
      if (method === 'PATCH') throw Object.assign(Error('Changed in another tab'), { code: 'DRAFT_CONFLICT' });
      const result = { draft: opening ? saved() : server };
      opening = false;
      return result;
    });
    const controller = createPrivateDraft({ api });
    await controller.open(scope, {});
    controller.edit({ title: 'My local edit' });
    await expect(controller.flush()).rejects.toThrow('another tab');
    expect(controller.state.conflict.content.title).toBe('Other tab');
    expect(controller.state.local.title).toBe('My local edit');
    expect(controller.resolve(true)).toEqual({ title: 'Other tab' });
    expect(controller.state.dirty).toBe(false);
    controller.close();
  });
  test('Lock cancels unsent writes and ignores a late private read', async () => {
    jest.useFakeTimers();
    let finish;
    const api = jest.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const controller = createPrivateDraft({ api });
    const opening = controller.open(scope, {});
    controller.edit({ title: 'Private unsent text' });
    controller.close();
    finish({ draft: saved() });
    await opening;
    await jest.advanceTimersByTimeAsync(1000);
    expect(api).toHaveBeenCalledTimes(1);
    expect(controller.state).toBeNull();
  });
  test('submission identity is acknowledged before a caller can dispatch a paid operation', async () => {
    let finish;
    const api = jest.fn((path, method) =>
      method === 'PATCH'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ draft: saved() })
    );
    const controller = createPrivateDraft({ api });
    await controller.open(scope, {});
    let ready = false;
    const pending = controller.submit({ purpose: 'story-creation' }, 'reviewed-action').then(() => {
      ready = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ready).toBe(false);
    finish({ draft: { ...saved(), revision: 3, submitted: { action_key: 'reviewed-action' } } });
    await pending;
    expect(ready).toBe(true);
    await expect(controller.submit({ purpose: 'story-creation' })).rejects.toThrow('previous submission');
    controller.close();
  });
  test('an unacknowledged creation after reload offers the existing result before another creation',async()=>{
    const creation={action_key:'created-once',kind:'story',result_id:'original-result'};
    const api=jest.fn(async(path,method,body)=>path.endsWith('/ack')?{acknowledged:true}:method==='POST'?{draft:{...saved(),content:body.content}}:{draft:null,creation});
    const controller=createPrivateDraft({api});await controller.open(scope,{title:'A setup'});expect(controller.state.creation.result_id).toBe('original-result');
    await expect(controller.flush()).rejects.toThrow('previous creation succeeded');await controller.acknowledgeCreation();await controller.flush();expect(controller.state.row).toBeTruthy();controller.close();
  });

});

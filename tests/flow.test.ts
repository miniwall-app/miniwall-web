import { describe, expect, it } from 'vitest';
import { applyAnswer, chosenOptions, initialSelections, linkedScreens, questionFields, screenLink } from '../src/flow';
import type { PaywallJson } from '../src';

const option = (id: string, onPress?: string) => ({ type: 'input_option', option_id: id, stack: { type: 'stack', components: [] }, ...(onPress ? { triggers: { on_press: onPress } } : {}) });
const screen: PaywallJson = {
  default_locale: 'en_US',
  components_localizations: {},
  components_config: {
    base: {
      stack: {
        type: 'stack',
        components: [
          { type: 'input_single_choice', field_id: 'goal', stack: { type: 'stack', components: [option('lose_weight', 'screen:step-2'), option('strength')] } },
          { type: 'input_multiple_choice', field_id: 'interests', stack: { type: 'stack', components: [option('yoga'), option('running')] } },
          { type: 'input_text', field_id: 'email' },
          { type: 'button', action: { type: 'workflow' }, triggers: { on_press: 'screen:step-3' }, stack: { type: 'stack', components: [] } },
          { type: 'button', action: { type: 'workflow' }, triggers: { on_press: 'screen:back' }, stack: { type: 'stack', components: [] } },
          { type: 'button', action: { type: 'workflow' }, triggers: { on_press: 'get_started' }, stack: { type: 'stack', components: [] } },
        ],
      },
    },
  },
};

describe('screen links', () => {
  it('tells screen changes from "Run your code" IDs', () => {
    expect(screenLink('screen:back')).toEqual({ kind: 'back' });
    expect(screenLink('screen:9b1c')).toEqual({ kind: 'goto', id: '9b1c' });
    expect(screenLink('screen:')).toBeNull();
    expect(screenLink('get_started')).toBeNull();
  });

  it('lists the screens a screen links to, from buttons and answers', () => {
    expect(linkedScreens(screen).sort()).toEqual(['step-2', 'step-3']);
  });
});

describe('answers', () => {
  const fields = questionFields(screen);

  it('knows each question and how its answer is kept', () => {
    expect([...fields]).toEqual([
      ['goal', 'single'],
      ['interests', 'multiple'],
      ['email', 'text'],
    ]);
  });

  it('replaces a single choice, toggles a multiple choice, and drops cleared text', () => {
    let answers = applyAnswer({}, 'single', 'goal', 'lose_weight');
    answers = applyAnswer(answers, 'single', 'goal', 'strength');
    answers = applyAnswer(answers, 'multiple', 'interests', 'yoga');
    answers = applyAnswer(answers, 'multiple', 'interests', 'running');
    answers = applyAnswer(answers, 'multiple', 'interests', 'yoga');
    answers = applyAnswer(answers, 'text', 'email', 'a@b.co');
    expect(answers).toEqual({ goal: 'strength', interests: ['running'], email: 'a@b.co' });
    expect(applyAnswer(answers, 'text', 'email', '')).toEqual({ goal: 'strength', interests: ['running'] });
    expect(applyAnswer(answers, 'multiple', 'interests', 'running')).toEqual({ goal: 'strength', email: 'a@b.co' });
    expect(initialSelections(answers)).toEqual({ goal: ['strength'], interests: ['running'], email: ['a@b.co'] });
  });

  it('counts chosen options only, never typed text', () => {
    expect(chosenOptions({ goal: 'strength', interests: ['yoga', 'running'], email: 'a@b.co' }, fields)).toEqual([
      { fieldId: 'goal', optionId: 'strength' },
      { fieldId: 'interests', optionId: 'yoga' },
      { fieldId: 'interests', optionId: 'running' },
    ]);
  });
});

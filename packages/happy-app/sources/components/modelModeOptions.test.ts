import { describe, expect, it } from 'vitest';
import {
    getAvailableModels,
    getAvailablePermissionModes,
    getCodexModelModes,
    getClaudeEffortLevels,
    getClaudeModelModes,
    getClaudePermissionModes,
    getDefaultEffortKey,
    getDefaultModelKey,
    getDefaultPermissionModeKey,
    mapMetadataOptions,
    prettyClaudeModelName,
    resolveClaudeOption,
    resolveCurrentOption,
} from './modelModeOptions';

const translate = (key: string) => `tr:${key}`;

describe('modelModeOptions', () => {
    it('maps metadata option shape into mode options', () => {
        expect(mapMetadataOptions([
            { code: 'm1', value: 'Model One', description: 'Primary model' },
            { code: 'm2', value: 'Model Two' },
        ])).toEqual([
            { key: 'm1', name: 'Model One', description: 'Primary model' },
            { key: 'm2', name: 'Model Two', description: null },
        ]);
    });

    it('builds claude permission fallbacks with translated names', () => {
        const modes = getClaudePermissionModes(translate);
        expect(modes.map((mode) => mode.key)).toEqual(['default', 'plan', 'auto', 'dontAsk', 'acceptEdits', 'bypassPermissions']);
        expect(modes[0].name).toBe('tr:agentInput.permissionMode.default');
    });

    it('builds codex model fallbacks', () => {
        const models = getCodexModelModes();
        expect(models.map((model) => model.key)).toEqual([
            'default',
            'gpt-5.5',
            'gpt-5.4',
            'gpt-5.3-codex',
            'gpt-5.2-codex',
            'gpt-5.1-codex-max',
            'gpt-5.2',
            'gpt-5.1-codex-mini',
        ]);
        expect(models[0].name).toBe('default model');
        expect(models[1].name).toBe('gpt-5.5');
    });

    it('uses code defaults for agent defaults', () => {
        expect(getDefaultPermissionModeKey('claude')).toBe('auto');
        expect(getDefaultModelKey('claude')).toBe('default');
        expect(getDefaultEffortKey('claude')).toBe('default');
        expect(getDefaultPermissionModeKey('codex')).toBe('yolo');
        expect(getDefaultModelKey('codex')).toBe('gpt-5.5');
        expect(getDefaultEffortKey('codex')).toBe('medium');
    });

    it('prefers metadata models over hardcoded fallbacks', () => {
        const models = getAvailableModels('gemini', {
            models: [
                { code: 'custom-gemini', value: 'Gemini Custom', description: 'From metadata' },
            ],
        } as any, translate);

        expect(models).toEqual([
            { key: 'custom-gemini', name: 'Gemini Custom', description: 'From metadata' },
        ]);
    });

    it('adds codex default model option when metadata models are present', () => {
        const models = getAvailableModels('codex', {
            models: [
                { code: 'gpt-5.4', value: 'gpt-5.4', description: 'Latest' },
            ],
        } as any, translate);

        expect(models).toEqual([
            { key: 'default', name: 'default model', description: null },
            { key: 'gpt-5.4', name: 'gpt-5.4', description: 'Latest' },
        ]);
    });

    it('keeps codex permission modes hardcoded even when metadata modes exist', () => {
        const modes = getAvailablePermissionModes('codex', {
            operatingModes: [{ code: 'metadata-only', value: 'Metadata Mode', description: null }],
        } as any, translate);

        expect(modes.map((mode) => mode.key)).toEqual(['default', 'read-only', 'safe-yolo', 'yolo']);
    });

    it('applies hacks to metadata-provided operating modes', () => {
        const modes = getAvailablePermissionModes('gemini', {
            operatingModes: [
                { code: 'build', value: 'build, build', description: 'Do build steps' },
                { code: 'plan', value: 'plan/plan', description: 'Plan first' },
            ],
        } as any, translate);

        expect(modes).toEqual([
            { key: 'build', name: 'Build', description: 'Do build steps' },
            { key: 'plan', name: 'Plan', description: 'Plan first' },
        ]);
    });

    it('resolves the first matching preferred key', () => {
        const options = [
            { key: 'a', name: 'A' },
            { key: 'b', name: 'B' },
        ];

        expect(resolveCurrentOption(options, ['missing', 'b', 'a'])).toEqual({ key: 'b', name: 'B' });
        expect(resolveCurrentOption(options, ['missing'])).toBeNull();
    });

    it('lists floating claude aliases with default first', () => {
        const keys = getClaudeModelModes().map((m) => m.key);
        expect(keys[0]).toBe('default');
        expect(keys).toEqual(expect.arrayContaining(['opus', 'sonnet', 'haiku', 'fable']));
        expect(getClaudeEffortLevels()[0].key).toBe('default');
    });

    it('prettifies claude model ids', () => {
        expect(prettyClaudeModelName('claude-opus-5-5')).toBe('opus 5.5');
        expect(prettyClaudeModelName('claude-opus-5')).toBe('opus 5');
        expect(prettyClaudeModelName('claude-haiku-4-5-20251001')).toBe('haiku 4.5');
        expect(prettyClaudeModelName('claude-fable-5-1')).toBe('fable 5.1');
        expect(prettyClaudeModelName('opus')).toBe('opus');
        expect(prettyClaudeModelName('opus[1m]')).toBe('opus (1M)');
    });

    it('shows the first set key even when it is not in the list', () => {
        const { options, current } = resolveClaudeOption(
            getClaudeModelModes(),
            ['claude-opus-4-8', 'default'],
            'claude-opus-5-5',
            prettyClaudeModelName,
        );
        expect(current?.key).toBe('claude-opus-4-8');
        expect(current?.name).toBe('opus 4.8');
        expect(options.some((o) => o.key === 'claude-opus-4-8')).toBe(true);
    });

    it('labels default with what the CLI reports in use', () => {
        const { options, current } = resolveClaudeOption(
            getClaudeModelModes(),
            [null, 'default'],
            'claude-opus-5-5',
            prettyClaudeModelName,
        );
        expect(current?.key).toBe('default');
        expect(current?.name).toBe('default (opus 5.5)');
        expect(options.find((o) => o.key === 'default')?.name).toBe('default (opus 5.5)');

        const effort = resolveClaudeOption(getClaudeEffortLevels(), [undefined, 'default'], 'xhigh', (v) => v);
        expect(effort.current?.name).toBe('default (xhigh)');
    });

    it('does not label an explicit non-default pick with the reported model', () => {
        const { current } = resolveClaudeOption(getClaudeModelModes(), ['sonnet'], 'claude-opus-5-5', prettyClaudeModelName);
        expect(current?.name).toBe('sonnet');
    });
});

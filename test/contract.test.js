const test = require('node:test');
const assert = require('node:assert/strict');
const { validateMedia } = require('../shared/contract');
const { rank } = require('../shared/title-match');
test('accepts a catalog stable ID', () => assert.equal(validateMedia({ id: 'sp:demo-001', type: 'series', title: 'Demo', aliases: [], episode: 1 }).id, 'sp:demo-001'));
test('refuses provider-private IDs', () => assert.throws(() => validateMedia({ id: 'htv:private', type: 'series', title: 'Demo', aliases: [] })));
test('ranks title aliases', () => assert.equal(rank({ title: 'Primary', aliases: ['Demo Animation'] }, [{ title: 'Demo Animation', url: '/demo' }])[0].url, '/demo'));

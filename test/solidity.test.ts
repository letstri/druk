import { describe, expect, test } from 'bun:test'

import { filetypeForPath } from '../src/languages/highlight'
import { loadMarketExtensions } from './helpers'
import { painted } from './syntax'

loadMarketExtensions()

describe('recognising solidity files', () => {
  test('by extension — OpenTUI does not know .sol', () => {
    expect(filetypeForPath('Token.sol')).toBe('solidity')
    expect(filetypeForPath('contracts/Token.sol')).toBe('solidity')
  })
})

describe('painting solidity files', () => {
  const SAMPLE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Token {
    uint256 public totalSupply;

    event Transfer(address indexed from, address indexed to, uint256 amount);

    constructor(uint256 supply) {
        totalSupply = supply;
    }

    function transfer(address to, uint256 amount) public returns (bool) {
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}
`

  test('keywords, types, names and strings light up', async () => {
    const group = await painted(SAMPLE, 'solidity')

    expect(group('keyword')).toEqual(
      expect.arrayContaining([
        'pragma',
        'contract',
        'public',
        'event',
        'function',
        'returns',
        'return',
      ])
    )
    expect(group('type')).toEqual(
      expect.arrayContaining(['Token', 'uint256', 'address', 'Transfer'])
    )
    expect(group('function')).toContain('transfer')
    expect(group('constructor')).toContain('constructor')
    expect(group('boolean')).toContain('true')
    expect(group('comment')[0]).toContain('SPDX-License-Identifier')
  })
})

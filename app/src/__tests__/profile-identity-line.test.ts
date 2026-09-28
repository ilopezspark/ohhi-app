import { identityLine } from '../profile/identityLine';

describe('identityLine', () => {
  it('renders all three parts: "CLC · cs \'27"', () => {
    expect(identityLine({ campusShort: 'CLC', majorLabel: 'cs', gradYear: 2027 })).toBe("CLC · cs '27");
  });

  it('degrades gracefully with no major', () => {
    expect(identityLine({ campusShort: 'CLC', majorLabel: null, gradYear: 2027 })).toBe("CLC · '27");
  });

  it('degrades gracefully with no grad year', () => {
    expect(identityLine({ campusShort: 'CLC', majorLabel: 'cs', gradYear: null })).toBe('CLC · cs');
  });

  it('degrades gracefully with no campus', () => {
    expect(identityLine({ campusShort: null, majorLabel: 'cs', gradYear: 2027 })).toBe("cs '27");
  });

  it('renders just the campus when nothing else is present', () => {
    expect(identityLine({ campusShort: 'CLC', majorLabel: null, gradYear: null })).toBe('CLC');
  });

  it('renders just the grad year when nothing else is present', () => {
    expect(identityLine({ campusShort: null, majorLabel: null, gradYear: 2027 })).toBe("'27");
  });

  it('renders "" when everything is missing', () => {
    expect(identityLine({ campusShort: null, majorLabel: null, gradYear: null })).toBe('');
    expect(identityLine({})).toBe('');
  });

  it('takes the last two digits of any grad year', () => {
    expect(identityLine({ campusShort: null, majorLabel: null, gradYear: 2099 })).toBe("'99");
  });
});

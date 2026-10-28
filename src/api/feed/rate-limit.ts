// Limite agregado por processo, adequado ao acesso local. Não confia em X-Forwarded-For.
// Instâncias distintas possuem janelas distintas; isto não é um limitador distribuído.
export function createFeedLimiter(limit = 120, windowMs = 60000) {
  let count = 0;
  let startsAt = 0;
  return (now = Date.now()): boolean => {
    if (now - startsAt >= windowMs || now < startsAt) {
      startsAt = now;
      count = 0;
    }
    if (count >= limit) return false;
    count++;
    return true;
  };
}

export const allowFeedRequest = createFeedLimiter();

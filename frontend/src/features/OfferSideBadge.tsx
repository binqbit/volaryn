import type { OfferSide } from '../lib/chain/actionTypes';
import styles from '../App.module.css';

export function OfferSideBadge({ side }: { side: OfferSide }) {
  return (
    <span className={styles.sideBadge} data-side={side}>
      {side === 'holder' ? 'Sell request' : 'Buy offer'}
    </span>
  );
}

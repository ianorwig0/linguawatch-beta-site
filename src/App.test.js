import { render, screen } from '@testing-library/react';
import App from './App';

test('renders LinguaWatch landing', () => {
  render(<App />);
  expect(screen.getByRole('link', { name: /LinguaWatch Home/i })).toBeInTheDocument();
});

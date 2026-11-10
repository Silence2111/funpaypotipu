/** «n***@mail.ru»: показать, куда сменили почту, но не весь адрес. */
export const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  return `${name?.slice(0, 1) ?? ''}***@${domain ?? ''}`;
};

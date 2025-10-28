import PropTypes from "prop-types";

// Footer.jsx
export default function Footer({ year, author }) {
  return (
    <footer>
      <p>
        © {year} {author}. All rights reserved.
      </p>
    </footer>
  );
}

Footer.propTypes = {
  year: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  author: PropTypes.string,
};

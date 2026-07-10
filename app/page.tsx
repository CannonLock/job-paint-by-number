import { Box, Typography, Container } from "@mui/material";

export default async function Home() {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Container maxWidth="md" sx={{ mt: 8 }}>
        <Typography variant="h4" component="h2" gutterBottom>
          Hello World!
        </Typography>
      </Container>
    </Box>
  );
}
